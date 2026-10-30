-- =============================================================================
-- 0100 (2026-10-28) · Item tinjauan Tahap 6 (docs/08 §11.1 #6, §11.2; Tahap 6b M4)
-- =============================================================================
-- Migration per milestone (F-136, D-95). Semua perubahan aditif; RLS tidak berubah.
--   * Q-77/§11.1 #6: capture_item.read_member_price, read_member_program_name (yang terbaca
--     worker, tidak bisa diubah user: tanpa GRANT UPDATE kolom). apply_extraction mengisinya;
--     W18 memetakan ulang harga member saat lokasi item berubah.
--   * app.match_member_program(): aturan pencocokan program member toko (dipakai apply_extraction
--     dan W18; isi sama dengan aturan lama di apply_extraction).
--   * §11.2 R18 get_active_session: labels[] + item_status, thumbnail_path (gambar posisi 1,
--     NULL jika sudah di-purge); vs_best_pct terhadap termurah 90 hari TANPA record dari capture
--     sesi ini (app.best_unit_price_excluding) (Q-80, Q-81, Q-97).
--   * §11.2 R20 price_record_detail: + source_text (Q-87, F-72).
-- Q-34/§11.1 #7 (receipt_line.is_member_discount) TIDAK dibuat: bersyarat data uji (Q-110).

alter table public.capture_item
  add column read_member_price numeric(14, 2) check (read_member_price >= 0),
  add column read_member_program_name text check (char_length(read_member_program_name) <= 200);

comment on column public.capture_item.read_member_price is
  'Harga member seperti terbaca extractor (Q-77). Tidak diubah user; dipakai W18 untuk pemetaan ulang program saat lokasi berubah.';
comment on column public.capture_item.read_member_program_name is
  'Nama program member seperti terbaca extractor (Q-77).';

-- Program member di toko p_store yang cocok dengan nama terbaca: nama ternormalisasi sama, atau
-- (nama tidak terbaca) satu-satunya program aktif toko itu. Tidak ada → NULL (D-52: member_note).
create function app.match_member_program(p_store uuid, p_name text) returns uuid
language sql stable
set search_path = ''
as $$
  select mp.id from public.member_program mp
   where p_store is not null and mp.store_id = p_store
     and (app.normalize_text(mp.name) = app.normalize_text(p_name)
          or (p_name is null
              and (select count(*) from public.member_program x where x.store_id = p_store and x.status = 'active') = 1
              and mp.status = 'active'))
   order by mp.id
   limit 1
$$;

-- -----------------------------------------------------------------------------
-- apply_extraction: isi read_member_*; pencocokan program lewat app.match_member_program
-- -----------------------------------------------------------------------------
create or replace function app.apply_extraction(p_capture_id uuid, p_run_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_c        public.capture;
  v_tau      numeric := app.config_numeric('auto_save_min_confidence');
  v_today    date;
  v_store    uuid;
  v_branch   uuid;
  v_loc      record;
  v_rid      uuid;
  v_fc       jsonb;
  v_line     jsonb;
  v_lineids  jsonb := '{}';
  v_lid      uuid;
  v_conf     numeric;
  v_prod     uuid;
  v_dup      uuid;
  v_hashdup  boolean;
  v_header_ok boolean;
  v_auto     integer := 0;
  v_pending  integer;
  v_item     jsonb;
  v_iid      uuid;
  v_prog     uuid;
  v_extra    jsonb;
  v_member   numeric;
  v_price    record;
  v_pos      integer := 0;
  v_status   text;
  v_total    numeric;
begin
  -- Worker basi (§5.3): run harus run 'running' terakhir dan capture masih processing.
  select * into v_c from public.capture where id = p_capture_id for update;
  if v_c.id is null or v_c.status <> 'processing'
     or not exists (select 1 from public.processing_run r where r.id = p_run_id and r.capture_id = v_c.id
                     and r.status = 'running')
     or exists (select 1 from public.processing_run r
                 where r.capture_id = v_c.id and r.started_at > (select started_at from public.processing_run where id = p_run_id)) then
    return jsonb_build_object('status', 'stale');
  end if;

  v_today := (coalesce(v_c.captured_at, v_c.uploaded_at)
              at time zone (select timezone from public.household where id = v_c.household_id))::date;

  -- Hash gambar sama dengan capture lain milik household (D-20 tahap 2, Q-29).
  select bool_or(true), (array_agg(r.id order by o.uploaded_at) filter (where r.id is not null))[1]
    into v_hashdup, v_dup
    from public.capture_image i
    join public.capture_image oi on oi.household_id = i.household_id and oi.sha256 = i.sha256 and oi.capture_id <> i.capture_id
    join public.capture o on o.id = oi.capture_id
    left join public.receipt r on r.capture_id = o.id and r.status <> 'discarded'
   where i.capture_id = v_c.id;
  v_hashdup := coalesce(v_hashdup, false);

  if v_c.kind = 'receipt' then
    -- 1. Toko: pilihan manual capture → nama terbaca. Tidak dikenali → NULL (D-49).
    select * into v_loc from app.capture_location(v_c.id, p_payload #>> '{store_hint,name}',
                                                  p_payload #>> '{store_hint,branch_name}');
    v_store := v_loc.store_id; v_branch := v_loc.branch_id;

    -- 2. Header + baris + penyesuaian.
    select coalesce(jsonb_object_agg(e.key, e.value), '{}') into v_fc
      from jsonb_each(coalesce(p_payload #> '{header,field_confidence}', '{}')) e
     where e.key in ('store', 'branch', 'date', 'time', 'total', 'subtotal') and jsonb_typeof(e.value) = 'number';
    select coalesce(sum((l ->> 'line_amount')::numeric), 0) into v_total
      from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]')) l;

    insert into public.receipt (household_id, capture_id, store_id, branch_id, transaction_date, transaction_time,
                                currency, subtotal_amount, total_amount, payment_method, pii, status, field_confidence)
    values (v_c.household_id, v_c.id, v_store, v_branch,
            coalesce((p_payload #>> '{header,transaction_date}')::date, v_today),
            (p_payload #>> '{header,transaction_time}')::time,
            coalesce(p_payload #>> '{header,currency}', (select default_currency from public.household where id = v_c.household_id)),
            (p_payload #>> '{header,subtotal_amount}')::numeric,
            coalesce((p_payload #>> '{header,total_amount}')::numeric, v_total),
            p_payload #>> '{header,payment_method}',
            coalesce(p_payload -> 'pii', '{}'), 'draft', v_fc)
    returning id into v_rid;

    for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'))
                  order by (value ->> 'line_no')::int loop
      v_prod := (v_line #>> '{match,product_id}')::uuid;
      if v_prod is not null and not exists (select 1 from public.product p where p.id = v_prod
                                             and (p.household_id is null or p.household_id = v_c.household_id)) then
        v_prod := null;                                         -- saran AI di luar katalog household diabaikan
      end if;
      insert into public.receipt_line (receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount,
                                       line_amount, applies_to_line_id, suggested_product_id, match_tier, match_confidence)
      values (v_rid, v_c.household_id, (v_line ->> 'line_no')::smallint, v_line ->> 'line_type', v_line ->> 'raw_text',
              (v_line ->> 'quantity')::numeric, (v_line ->> 'unit_amount')::numeric, (v_line ->> 'line_amount')::numeric,
              (v_lineids ->> (v_line ->> 'applies_to_line_no'))::uuid,
              v_prod, case when v_prod is not null then v_line #>> '{match,tier}' end,
              case when v_prod is not null then (v_line #>> '{match,confidence}')::numeric end)
      returning id into v_lid;
      v_lineids := v_lineids || jsonb_build_object(v_line ->> 'line_no', v_lid);
    end loop;

    insert into public.receipt_adjustment (receipt_id, household_id, kind, description, amount, points)
    select v_rid, v_c.household_id, a ->> 'kind', a ->> 'description', (a ->> 'amount')::numeric, (a ->> 'points')::numeric
      from jsonb_array_elements(coalesce(p_payload -> 'adjustments', '[]')) a;

    -- 3. Kecurigaan duplikat (sidik jari di bawah kunci advisory, atau hash gambar).
    if v_store is not null then
      perform pg_advisory_xact_lock(hashtextextended(format('receipt:%s:%s:%s:%s', v_c.household_id, v_store,
        (select transaction_date from public.receipt where id = v_rid), (select total_amount from public.receipt where id = v_rid)), 0));
      v_dup := coalesce(v_dup, (select o.id from public.receipt r
                                  join public.receipt o on o.household_id = r.household_id and o.id <> r.id
                                                       and o.store_id = r.store_id and o.transaction_date = r.transaction_date
                                                       and o.total_amount = r.total_amount and o.status <> 'discarded'
                                 where r.id = v_rid order by o.created_at limit 1));
    end if;
    if v_dup is not null then
      update public.receipt set duplicate_of_receipt_id = v_dup where id = v_rid;
    end if;

    -- 4. Header layak auto-save (D-50, D-71/Q-13): bukan duplikat, toko ada, confidence toko & tanggal ≥ τ.
    v_header_ok := v_dup is null and not v_hashdup and v_store is not null
                   and coalesce((v_fc ->> 'store')::numeric, 0) >= v_tau
                   and coalesce((v_fc ->> 'date')::numeric, 0) >= v_tau;

    -- 5. Baris produk confidence ≥ τ dan bukan bundle → record auto (tanpa alias).
    if v_header_ok then
      for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]')) loop
        continue when v_line ->> 'line_type' <> 'product' or coalesce((v_line ->> 'is_bundle')::boolean, false);
        v_lid := (v_lineids ->> (v_line ->> 'line_no'))::uuid;
        select suggested_product_id, match_confidence into v_prod, v_conf from public.receipt_line where id = v_lid;
        v_conf := least(v_conf, coalesce((v_line ->> 'parse_confidence')::numeric, 1));
        if v_prod is not null and v_conf >= v_tau then
          if app.upsert_receipt_record(v_lid, v_prod, 'auto') is not null then
            v_auto := v_auto + 1;
          end if;
        end if;
      end loop;
    end if;

    -- 6. Semua baris produk yang bisa punya record sudah punya record → confirmed + done.
    select count(*) into v_pending
      from public.receipt_line l
     where l.receipt_id = v_rid and l.line_type = 'product'
       and not exists (select 1 from public.price_record pr where pr.receipt_line_id = l.id)
       and (l.suggested_product_id is null
            or exists (select 1 from app.derive_receipt_price(l.id, l.suggested_product_id)));
    if v_header_ok and v_pending = 0 then
      update public.receipt set status = 'confirmed', confirmed_at = now() where id = v_rid;
      v_status := 'done';
    else
      v_status := 'needs_confirmation';
    end if;

  else
    -- Label / screenshot. 1. Lokasi: sesi → pilihan manual capture → store_hint.
    select * into v_loc from app.capture_location(v_c.id, p_payload #>> '{store_hint,name}',
                                                  p_payload #>> '{store_hint,branch_name}');
    v_store := v_loc.store_id; v_branch := v_loc.branch_id;

    -- 2. capture_item per item.
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]')) loop
      v_pos := v_pos + 1;
      v_prod := (v_item #>> '{match,product_id}')::uuid;
      if v_prod is not null and not exists (select 1 from public.product p where p.id = v_prod
                                             and (p.household_id is null or p.household_id = v_c.household_id)) then
        v_prod := null;
      end if;

      -- Program member terbaca → katalog program toko; tidak ada → member_note (D-52).
      v_prog := null; v_member := (v_item ->> 'member_price')::numeric;
      v_extra := jsonb_strip_nulls(jsonb_build_object(
        'shipping_fee', v_item -> 'shipping_fee', 'shop_voucher', v_item -> 'shop_voucher',
        'cashback', v_item -> 'cashback', 'points', v_item -> 'points',
        'listing_title', v_item -> 'listing_title', 'listing_url', v_item -> 'listing_url'));
      if v_member is not null then
        v_prog := app.match_member_program(v_store, v_item ->> 'member_program_name');
        if v_prog is null then
          v_extra := v_extra || jsonb_build_object('member_note',
                       left(coalesce(v_item ->> 'member_program_name', 'Harga member') || ' ' || v_member::text, 200));
          v_member := null;
        end if;
      end if;
      if not app.valid_price_extra(v_extra) then
        v_extra := '{}';
      end if;

      insert into public.capture_item (
        capture_id, household_id, position, image_position, region, raw_text, suggested_product_id,
        candidate_product_ids, match_tier, match_confidence, store_id, branch_id, seller_name, seller_ref,
        transaction_date, currency, normal_price, promo_price, promo_min_qty, promo_valid_from, promo_valid_until,
        member_price, member_program_id, is_bundle, extra, field_confidence,
        read_member_price, read_member_program_name)
      values (
        v_c.id, v_c.household_id, v_pos, (v_item ->> 'image_position')::smallint, v_item -> 'region',
        coalesce(v_item ->> 'raw_text', ''), v_prod,
        coalesce((select array_agg((c ->> 'product_id')::uuid) from (
                    select c from jsonb_array_elements(coalesce(v_item #> '{match,candidates}', '[]')) c
                     where exists (select 1 from public.product p where p.id = (c ->> 'product_id')::uuid
                                    and (p.household_id is null or p.household_id = v_c.household_id))
                     limit 5) x), '{}'),
        case when v_prod is not null then v_item #>> '{match,tier}' end,
        case when v_prod is not null then (v_item #>> '{match,confidence}')::numeric end,
        v_store, case when v_store is not null then v_branch end,
        v_item ->> 'seller_name', v_item ->> 'seller_ref',
        coalesce((v_item ->> 'transaction_date')::date, v_today),
        coalesce(v_item ->> 'currency', (select default_currency from public.household where id = v_c.household_id)),
        (v_item ->> 'normal_price')::numeric, (v_item ->> 'promo_price')::numeric,
        (v_item ->> 'promo_min_qty')::integer, (v_item ->> 'promo_valid_from')::date,
        (v_item ->> 'promo_valid_until')::date, v_member, v_prog,
        coalesce((v_item ->> 'is_bundle')::boolean, false), v_extra,
        coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(v_item -> 'field_confidence', '{}')) e
                   where e.key in ('product', 'price', 'date', 'store') and jsonb_typeof(e.value) = 'number'), '{}'),
        (v_item ->> 'member_price')::numeric, nullif(btrim(v_item ->> 'member_program_name'), ''))
      returning id into v_iid;

      -- 3. Auto-accept: confidence ≥ τ, toko diketahui, ada harga berlaku, bukan bundle,
      --    gambar tidak dicurigai duplikat hash (D-50). Tanpa alias.
      v_conf := least(coalesce((v_item #>> '{match,confidence}')::numeric, 0),
                      coalesce((v_item #>> '{field_confidence,price}')::numeric, 1));
      if v_prod is not null and v_conf >= v_tau and v_store is not null and not v_hashdup
         and not coalesce((v_item ->> 'is_bundle')::boolean, false) then
        select * into v_price
          from app.observation_price(v_c.household_id, coalesce((v_item ->> 'transaction_date')::date, v_today),
                                     (v_item ->> 'normal_price')::numeric, (v_item ->> 'promo_price')::numeric,
                                     (v_item ->> 'promo_valid_from')::date, (v_item ->> 'promo_valid_until')::date,
                                     v_member, v_prog);
        if v_price.effective_price is not null then
          perform app.accept_capture_item(v_iid, v_prod, 'auto', false);
          v_auto := v_auto + 1;
        end if;
      end if;
    end loop;

    -- 4. Ada item pending → needs_confirmation, selain itu done.
    select count(*) into v_pending from public.capture_item where capture_id = v_c.id and status = 'pending';
    v_status := case when v_pending > 0 then 'needs_confirmation' else 'done' end;
  end if;

  -- 7. Run sukses; status capture final putaran ini.
  update public.processing_run set status = 'succeeded', finished_at = now() where id = p_run_id;
  update public.capture set status = v_status, processed_at = now(), error_message = null, error_code = null
   where id = v_c.id;
  return jsonb_build_object('status', v_status, 'receipt_id', v_rid, 'auto_saved', v_auto,
                            'pending', v_pending, 'store_id', v_store, 'duplicate_of', v_dup,
                            'hash_duplicate', v_hashdup);
end $$;

-- -----------------------------------------------------------------------------
-- W18 update_capture_item: pemetaan ulang harga member saat lokasi berubah (Q-77)
-- -----------------------------------------------------------------------------
create or replace function public.update_capture_item(p_item_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_i    public.capture_item;
  v_n    public.capture_item;
  v_prog uuid;
begin
  perform app.check_patch_keys(p_patch, array[
    'product_id', 'store_id', 'branch_id', 'seller_name', 'seller_ref', 'transaction_date', 'currency',
    'normal_price', 'promo_price', 'promo_min_qty', 'promo_valid_from', 'promo_valid_until',
    'member_price', 'member_program_id', 'is_bundle', 'extra']);
  select * into v_i from public.capture_item where id = p_item_id for update;
  if v_i.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('item_id', p_item_id));
  end if;
  if v_i.status <> 'pending' then
    perform app.err('INVALID_STATE', jsonb_build_object('item_id', v_i.id, 'status', v_i.status));
  end if;
  if v_i.updated_at is distinct from p_expected_updated_at then
    perform app.err('STALE_WRITE', jsonb_build_object('item_id', v_i.id, 'updated_at', v_i.updated_at));
  end if;
  if p_patch ? 'extra' and not app.valid_price_extra(coalesce(p_patch -> 'extra', 'null')) then
    perform app.err('INVALID_EXTRA', jsonb_build_object('extra', p_patch -> 'extra'));
  end if;

  update public.capture_item set
    suggested_product_id = case when p_patch ? 'product_id' then app.resolve_product((p_patch ->> 'product_id')::uuid) else suggested_product_id end,
    match_tier        = case when p_patch ? 'product_id' and (p_patch ->> 'product_id')::uuid is distinct from suggested_product_id
                             then 'manual' else match_tier end,
    store_id          = case when p_patch ? 'store_id'          then (p_patch ->> 'store_id')::uuid else store_id end,
    branch_id         = case when p_patch ? 'branch_id'         then (p_patch ->> 'branch_id')::uuid
                             when p_patch ? 'store_id'          then null else branch_id end,
    seller_name       = case when p_patch ? 'seller_name'       then p_patch ->> 'seller_name' else seller_name end,
    seller_ref        = case when p_patch ? 'seller_ref'        then p_patch ->> 'seller_ref' else seller_ref end,
    transaction_date  = case when p_patch ? 'transaction_date'  then (p_patch ->> 'transaction_date')::date else transaction_date end,
    currency          = case when p_patch ? 'currency'          then p_patch ->> 'currency' else currency end,
    normal_price      = case when p_patch ? 'normal_price'      then (p_patch ->> 'normal_price')::numeric else normal_price end,
    promo_price       = case when p_patch ? 'promo_price'       then (p_patch ->> 'promo_price')::numeric else promo_price end,
    promo_min_qty     = case when p_patch ? 'promo_min_qty'     then (p_patch ->> 'promo_min_qty')::integer else promo_min_qty end,
    promo_valid_from  = case when p_patch ? 'promo_valid_from'  then (p_patch ->> 'promo_valid_from')::date else promo_valid_from end,
    promo_valid_until = case when p_patch ? 'promo_valid_until' then (p_patch ->> 'promo_valid_until')::date else promo_valid_until end,
    member_price      = case when p_patch ? 'member_price'      then (p_patch ->> 'member_price')::numeric else member_price end,
    member_program_id = case when p_patch ? 'member_program_id' then (p_patch ->> 'member_program_id')::uuid else member_program_id end,
    is_bundle         = case when p_patch ? 'is_bundle'         then coalesce((p_patch ->> 'is_bundle')::boolean, false) else is_bundle end,
    extra             = case when p_patch ? 'extra'             then p_patch -> 'extra' else extra end
   where id = v_i.id;

  -- Q-77 (docs/08 §11.1 #6): lokasi item berubah → harga member TERBACA dipetakan ulang ke program
  -- toko baru (aturan app.match_member_program, sama dengan apply_extraction). Tidak dijalankan jika
  -- user mengubah harga/program member di patch yang sama (pilihan user menang).
  if p_patch ? 'store_id' and not (p_patch ? 'member_price' or p_patch ? 'member_program_id')
     and v_i.read_member_price is not null then
    select * into v_n from public.capture_item where id = v_i.id;
    if v_n.member_program_id is null
       or not exists (select 1 from public.member_program mp
                       where mp.id = v_n.member_program_id and mp.store_id is not distinct from v_n.store_id) then
      v_prog := app.match_member_program(v_n.store_id, v_i.read_member_program_name);
      if v_prog is not null then
        update public.capture_item set
          member_price      = coalesce(v_n.member_price, v_i.read_member_price),
          member_program_id = v_prog,
          extra             = extra - 'member_note'
         where id = v_i.id;
      elsif v_n.member_program_id is not null then
        -- Program toko lama tidak berlaku di toko baru → kembali jadi catatan (D-52).
        update public.capture_item set
          member_price      = null,
          member_program_id = null,
          extra             = extra || jsonb_build_object('member_note',
                                 left(coalesce(v_i.read_member_program_name, 'Harga member') || ' '
                                      || trim_scale(coalesce(v_n.member_price, v_i.read_member_price))::text, 200))
         where id = v_i.id;
      end if;
    end if;
  end if;

  return app.capture_item_json(v_i.id);
end $$;


-- -----------------------------------------------------------------------------
-- R18 get_active_session (§11.2, Q-80/Q-81/Q-97)
-- -----------------------------------------------------------------------------
-- Termurah (harga per satuan) dalam jendela best_price_window_days untuk produk household,
-- dengan aturan ringkasan (refresh_price_summary): aktif, bukan bundle, mata uang default
-- household; harga member sudah tercermin di unit_price record (D-26). Record dari capture
-- p_capture_ids tidak dihitung, sehingga label sesi yang menjadi harga terbaik baru tampil
-- "X% lebih murah", bukan "setara" (F-60). DEFINER karena app.config tidak terbaca user; household
-- dibatasi ke household pemanggil (app.my_household_ids), sama dengan RLS price_record.
create function app.best_unit_price_excluding(p_product uuid, p_household uuid, p_capture_ids uuid[])
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select min(pr.unit_price)
    from public.price_record pr
   where pr.household_id = p_household and pr.product_id = p_product
     and pr.status = 'active' and not pr.is_bundle
     and pr.currency = (select h.default_currency from public.household h where h.id = p_household)
     and pr.transaction_date > current_date - app.config_int('best_price_window_days')
     and (pr.capture_id is null or pr.capture_id <> all (coalesce(p_capture_ids, '{}')))
     and ((select auth.uid()) is null or p_household in (select app.my_household_ids()))
$$;

create or replace function public.get_active_session() returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'started_at', s.started_at, 'expires_at', s.expires_at),
    'store', app.store_json(b.store_id),
    'branch', app.branch_json(b.id),
    'labels', coalesce((
      select jsonb_agg(l.j order by l.uploaded_at desc, l.position)
        from (
          select c.uploaded_at, coalesce(i.position, 0) as position,
                 jsonb_build_object(
                   'capture_id', c.id, 'status', c.status, 'item_id', i.id,
                   'item_status', i.status,
                   'thumbnail_path', (select ci.storage_path from public.capture_image ci
                                       where ci.capture_id = c.id and ci.purged_at is null
                                       order by ci.position limit 1),
                   'product', app.product_lite(coalesce(pr.product_id, i.suggested_product_id)),
                   'effective_price', coalesce(pr.effective_price, op.effective_price),
                   'price_basis', coalesce(pr.price_basis, op.price_basis),
                   'vs_best_pct', round((u.unit_price - bx.best) / nullif(bx.best, 0) * 100, 1),
                   'vs_last_pct', round((u.unit_price - sm.last_unit_price) / nullif(sm.last_unit_price, 0) * 100, 1)) as j
            from public.capture c
            left join public.capture_item i on i.capture_id = c.id and i.status <> 'rejected'
            left join public.price_record pr on pr.id = i.price_record_id
            left join lateral (select * from app.observation_price(i.household_id, i.transaction_date, i.normal_price,
                                 i.promo_price, i.promo_valid_from, i.promo_valid_until, i.member_price,
                                 i.member_program_id)) op on i.id is not null and pr.id is null
            left join lateral (select coalesce(pr.unit_price,
                                               app.unit_price_for(i.suggested_product_id, op.effective_price)) as unit_price) u on true
            left join public.price_summary sm on sm.product_id = coalesce(pr.product_id, i.suggested_product_id)
            left join lateral (select app.best_unit_price_excluding(
                                        coalesce(pr.product_id, i.suggested_product_id), c.household_id,
                                        array(select x.id from public.capture x where x.shopping_session_id = s.id)) as best
                               ) bx on coalesce(pr.product_id, i.suggested_product_id) is not null
           where c.shopping_session_id = s.id) l), '[]'::jsonb))
    from public.shopping_session s
    join public.branch b on b.id = s.branch_id
   where s.ended_at is null and s.expires_at > now()
   order by s.started_at desc
   limit 1
$$;

-- -----------------------------------------------------------------------------
-- R20 price_record_detail + source_text (§11.2, Q-87)
-- -----------------------------------------------------------------------------
create or replace function public.price_record_detail(p_id uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_rec jsonb;
  v_pr  public.price_record;
  v_line public.receipt_line;
  v_img jsonb;
  v_src text;
begin
  select * into v_pr from public.price_record where id = p_id;
  if v_pr.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('price_record_id', p_id));
  end if;
  select to_jsonb(v) into v_rec from public.price_record_view v where v.id = p_id;
  select * into v_line from public.receipt_line where id = v_pr.receipt_line_id;

  -- Q-87/F-72: teks sumber alias (aturan sama dengan alias W6 p_update_alias).
  if v_line.id is not null then
    v_src := v_line.raw_text;
  else
    select case when v_pr.source_type = 'marketplace' then coalesce(i.extra ->> 'listing_title', i.raw_text)
                else i.raw_text end
      into v_src from public.capture_item i where i.price_record_id = v_pr.id;
  end if;

  select jsonb_build_object('storage_path', ci.storage_path, 'position', ci.position, 'purged_at', ci.purged_at)
    into v_img
    from public.capture_image ci
   where ci.capture_id = v_pr.capture_id
   order by (ci.position = coalesce((select it.image_position from public.capture_item it
                                      where it.price_record_id = v_pr.id), 1)) desc, ci.position
   limit 1;

  return jsonb_build_object(
    'record', v_rec,
    'receipt_line', case when v_line.id is null then null else
      jsonb_build_object('id', v_line.id, 'receipt_id', v_line.receipt_id, 'line_no', v_line.line_no,
                         'raw_text', v_line.raw_text, 'quantity', v_line.quantity,
                         'unit_amount', v_line.unit_amount, 'line_amount', v_line.line_amount,
                         'updated_at', v_line.updated_at,
                         'attached', coalesce((select jsonb_agg(jsonb_build_object(
                                                  'id', a.id, 'line_type', a.line_type, 'raw_text', a.raw_text,
                                                  'quantity', a.quantity, 'line_amount', a.line_amount)
                                                  order by a.line_no)
                                                 from public.receipt_line a where a.applies_to_line_id = v_line.id),
                                              '[]'::jsonb)) end,
    'receipt_header', (select jsonb_build_object('id', r.id, 'status', r.status, 'transaction_date', r.transaction_date,
                                                 'transaction_time', r.transaction_time, 'total_amount', r.total_amount,
                                                 'store', app.store_json(r.store_id), 'branch', app.branch_json(r.branch_id),
                                                 'updated_at', r.updated_at)
                         from public.receipt r where r.id = v_line.receipt_id),
    'image', v_img,
    'source_text', nullif(btrim(v_src), ''),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'entity_type', a.entity_type,
                                                             'action', a.action, 'actor_id', a.actor_id,
                                                             'before', a.before, 'after', a.after,
                                                             'created_at', a.created_at) order by a.created_at, a.id)
                           from public.audit_log a
                          where (a.entity_type = 'price_record' and a.entity_id = v_pr.id)
                             or (a.entity_type = 'receipt_line' and a.entity_id = v_pr.receipt_line_id)), '[]'::jsonb));
end $$;


-- -----------------------------------------------------------------------------
-- Hak akses (F-09): fungsi app baru eksplisit. create or replace mempertahankan hak fungsi lama.
-- -----------------------------------------------------------------------------
revoke all on function app.match_member_program(uuid, text) from public, anon, authenticated;
grant execute on function app.match_member_program(uuid, text) to authenticated, service_role;
revoke all on function app.best_unit_price_excluding(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function app.best_unit_price_excluding(uuid, uuid, uuid[]) to authenticated, service_role;
