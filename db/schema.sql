-- =============================================================================
-- PriceAtlas — Snapshot skema (DIBANGKITKAN, JANGAN DIEDIT)
-- =============================================================================
-- Sumber kebenaran: supabase/migrations/ (D-72). File ini dibangkitkan oleh
-- db/scripts/snapshot.sh dan diperiksa CI (tidak boleh ada drift).
-- Desain: docs/03-database-design.md, docs/05-backend-design.md.
-- Skema Tahap 2b yang asli: db/tests/fixtures/schema-2b.sql (= migration baseline).
--
-- Tidak termasuk di sini (lihat migration masing-masing):
--   * trigger on_auth_user_created di auth.users (baseline)
--   * bucket Storage `captures` dan policy storage.objects (…0150_storage.sql)
--   * extension pg_trgm/btree_gist (baseline), jadwal pg_cron (…0900_cron.sql)
--   * zona waktu database Asia/Jakarta (…0230_hardening.sql)
-- =============================================================================

--
-- PostgreSQL database dump
--

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';

--
-- Name: accept_capture_item(uuid, uuid, text, boolean); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.accept_capture_item(p_item_id uuid, p_product_id uuid, p_outcome text, p_create_alias boolean) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_i       public.capture_item;
  v_c       public.capture;
  v_store   uuid;
  v_branch  uuid;
  v_price   record;
  v_product uuid := app.resolve_product(coalesce(p_product_id, (select suggested_product_id from public.capture_item where id = p_item_id)));
  v_extra   jsonb;
  v_rec     uuid;
begin
  select * into v_i from public.capture_item where id = p_item_id for update;
  select * into v_c from public.capture where id = v_i.capture_id;

  if v_product is null or not exists (select 1 from public.product where id = v_product and status = 'active') then
    perform app.err('NOT_FOUND', jsonb_build_object('item_id', v_i.id, 'product_id', p_product_id));
  end if;

  -- 4. Lokasi: item → capture → sesi (D-11). Store wajib, branch opsional (D-28).
  if v_i.store_id is not null then
    v_store := v_i.store_id; v_branch := v_i.branch_id;
  elsif v_c.store_id is not null then
    v_store := v_c.store_id; v_branch := v_c.branch_id;
  elsif v_c.shopping_session_id is not null then
    select b.store_id, b.id into v_store, v_branch
      from public.shopping_session s join public.branch b on b.id = s.branch_id
     where s.id = v_c.shopping_session_id;
  end if;
  if v_store is null then
    perform app.err('STORE_REQUIRED', jsonb_build_object('item_id', v_i.id));
  end if;

  -- 5. Seller marketplace → branch kind seller (global atau milik household), atau branch privat baru.
  if v_c.kind = 'marketplace' and v_branch is null and app.normalize_text(v_i.seller_name) is not null then
    select b.id into v_branch
      from public.branch b
     where b.store_id = v_store and b.kind = 'seller'
       and (b.household_id is null or b.household_id = v_i.household_id)
       and ((v_i.seller_ref is not null and b.external_ref = v_i.seller_ref)
            or app.normalize_text(b.name) = app.normalize_text(v_i.seller_name))
     order by (b.household_id is null) desc, (b.external_ref = v_i.seller_ref) desc nulls last, b.created_at
     limit 1;
    if v_branch is null then
      insert into public.branch (household_id, store_id, kind, name, external_ref)
      values (v_i.household_id, v_store, 'seller', v_i.seller_name, v_i.seller_ref)
      returning id into v_branch;
    end if;
  end if;

  -- 6. Harga efektif dengan keanggotaan saat ini (D-26, D-27).
  select * into v_price
    from app.observation_price(v_i.household_id, v_i.transaction_date, v_i.normal_price, v_i.promo_price,
                               v_i.promo_valid_from, v_i.promo_valid_until, v_i.member_price, v_i.member_program_id);
  if v_price.effective_price is null then
    perform app.err('NO_APPLICABLE_PRICE', jsonb_build_object('item_id', v_i.id));
  end if;

  v_extra := v_i.extra - 'member_eligible';
  if v_i.member_price is not null then
    v_extra := v_extra || jsonb_build_object('member_eligible', coalesce(v_price.member_eligible, false));   -- F-11
  end if;

  -- 7. Record (visibility diisi trigger D-67).
  insert into public.price_record (
    household_id, product_id, store_id, branch_id, source_type, capture_id, transaction_date, currency,
    normal_price, promo_price, promo_min_qty, promo_valid_from, promo_valid_until, member_price, member_program_id,
    effective_price, price_basis, is_bundle, extra, match_tier, match_confidence, match_outcome, created_by)
  values (
    v_i.household_id, v_product, v_store, v_branch, v_c.kind, v_c.id, v_i.transaction_date, v_i.currency,
    v_i.normal_price, v_i.promo_price, v_i.promo_min_qty, v_i.promo_valid_from, v_i.promo_valid_until,
    v_i.member_price, v_i.member_program_id, v_price.effective_price, v_price.price_basis, v_i.is_bundle,
    v_extra, v_i.match_tier, v_i.match_confidence, p_outcome, (select auth.uid()))
  returning id into v_rec;

  perform app.mark_rpc();
  update public.capture_item
     set status = 'accepted', price_record_id = v_rec, store_id = v_store, branch_id = v_branch,
         decided_by = (select auth.uid()), decided_at = now()
   where id = v_i.id;

  -- 8. Alias household: teks label atau judul listing (D-13, D-35).
  if p_create_alias then
    perform app.upsert_household_alias(v_i.household_id, v_store, v_product,
              case when v_c.kind = 'marketplace' then coalesce(v_i.extra ->> 'listing_title', v_i.raw_text)
                   else v_i.raw_text end);
  end if;
  return v_rec;
end $$;

--
-- Name: ai_spend_today(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.ai_spend_today() RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((select sum(cost_usd) from public.processing_run
                    where started_at >= current_date::timestamptz
                      and started_at <  (current_date + 1)::timestamptz), 0)
       + coalesce((select sum(cost_usd) from app.ask_usage where day = current_date), 0)
$$;

--
-- Name: apply_extraction(uuid, uuid, jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.apply_extraction(p_capture_id uuid, p_run_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

--
-- Name: apply_redaction(uuid, text, jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.apply_redaction(p_run_id uuid, p_raw_ocr_text text, p_raw_ai_output jsonb) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with u as (
    update public.processing_run
       set raw_ocr_text = p_raw_ocr_text, raw_ai_output = p_raw_ai_output, pii_redacted_at = now()
     where id = p_run_id and pii_redacted_at is null
    returning 1)
  select exists (select 1 from u)
$$;

--
-- Name: audit_row(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.audit_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_household uuid := coalesce(to_jsonb(new) ->> 'household_id', to_jsonb(old) ->> 'household_id')::uuid;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'pii' end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'pii' end;
begin
  if (select auth.uid()) is null or v_household is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and v_new - 'updated_at' = v_old - 'updated_at' then
    return null;
  end if;
  insert into public.audit_log (household_id, actor_id, entity_type, entity_id, action, before, after)
  values (v_household, (select auth.uid()), tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id')::uuid,
          lower(tg_op), v_old, v_new);
  return null;
end $$;

--
-- Name: barcode_copy_owner(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.barcode_copy_owner() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  select household_id into new.household_id from public.product where id = new.product_id;
  return new;
end $$;

--
-- Name: base_unit(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.base_unit(p_dimension text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$ select case p_dimension when 'mass' then 'g' when 'volume' then 'ml'
                              when 'count' then 'pcs' when 'length' then 'm' end $$;

--
-- Name: begin_account_deletion(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.begin_account_deletion(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_m        record;
  v_archived jsonb := '[]';
  v_removed  integer := 0;
begin
  for v_m in select m.household_id from public.household_member m where m.user_id = p_user_id for update loop
    if (select count(*) from public.household_member where household_id = v_m.household_id) = 1 then
      update public.household set archived_at = coalesce(archived_at, now()) where id = v_m.household_id;
      insert into app.job (kind, payload)
      select 'delete_household', jsonb_build_object('household_id', v_m.household_id)
       where not exists (select 1 from app.job j where j.kind = 'delete_household' and j.status in ('pending', 'running')
                          and j.payload ->> 'household_id' = v_m.household_id::text);
      v_archived := v_archived || to_jsonb(v_m.household_id);
    else
      delete from public.household_member where household_id = v_m.household_id and user_id = p_user_id;
      v_removed := v_removed + 1;
    end if;
  end loop;
  -- Langkah ini idempoten: household yang sudah diarsipkan dan job yang sudah antre tidak digandakan.
  return jsonb_build_object('archived_households', v_archived, 'memberships_removed', v_removed);
end $$;

--
-- Name: best_unit_price_excluding(uuid, uuid, uuid[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.best_unit_price_excluding(p_product uuid, p_household uuid, p_capture_ids uuid[]) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select min(pr.unit_price)
    from public.price_record pr
   where pr.household_id = p_household and pr.product_id = p_product
     and pr.status = 'active' and not pr.is_bundle
     and pr.currency = (select h.default_currency from public.household h where h.id = p_household)
     and pr.transaction_date > current_date - app.config_int('best_price_window_days')
     and (pr.capture_id is null or pr.capture_id <> all (coalesce(p_capture_ids, '{}')))
     and ((select auth.uid()) is null or p_household in (select app.my_household_ids()))
$$;

--
-- Name: branch_json(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.branch_json(p_branch_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'status', b.status, 'kind', b.kind,
                            'is_private', b.household_id is not null)
    from public.branch b where b.id = p_branch_id
$$;

--
-- Name: capture_item_guard(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.capture_item_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = 'on';
begin
  if old.status <> 'pending' then
    if (to_jsonb(new) - 'price_record_id' - 'updated_at') = (to_jsonb(old) - 'price_record_id' - 'updated_at')
       and new.price_record_id is null then
      return new;
    end if;
    if not v_rpc then
      perform app.err('INVALID_STATE', jsonb_build_object('item_id', old.id, 'status', old.status));
    end if;
  end if;
  if (new.status, new.price_record_id, new.decided_at, new.decided_by)
       is distinct from (old.status, old.price_record_id, old.decided_at, old.decided_by)
     and not v_rpc then
    perform app.err('INVALID_STATE', jsonb_build_object('item_id', old.id, 'reason', 'decision_via_rpc_only'));
  end if;
  return new;
end $$;

--
-- Name: capture_item_json(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.capture_item_json(p_item_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select x from public.capture_item i
   cross join lateral public.get_capture_items(i.capture_id) x
   where i.id = p_item_id and (x ->> 'id')::uuid = p_item_id
$$;

--
-- Name: capture_location(uuid, text, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.capture_location(p_capture_id uuid, p_store_name text, p_branch_name text DEFAULT NULL::text) RETURNS TABLE(store_id uuid, branch_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_c public.capture;
  v_store uuid;
  v_branch uuid;
begin
  select * into v_c from public.capture where id = p_capture_id;
  if v_c.kind <> 'receipt' and v_c.shopping_session_id is not null then
    select b.store_id, b.id into v_store, v_branch
      from public.shopping_session s join public.branch b on b.id = s.branch_id
     where s.id = v_c.shopping_session_id;
  end if;
  if v_store is null and v_c.store_id is not null then
    v_store := v_c.store_id; v_branch := v_c.branch_id;
  end if;
  if v_store is null then
    select r.store_id, r.branch_id into v_store, v_branch
      from app.resolve_store(v_c.household_id, p_store_name, p_branch_name) r;
  end if;
  store_id := v_store;
  branch_id := v_branch;
  return next;
end $$;

--
-- Name: capture_round_runs(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.capture_round_runs(p_capture_id uuid) RETURNS TABLE(n integer, last_finished timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select count(*)::integer, max(r.finished_at)
    from public.processing_run r
    join public.capture c on c.id = r.capture_id
   where r.capture_id = p_capture_id
     and r.started_at > coalesce(c.processed_at, '-infinity'::timestamptz)
$$;

--
-- Name: capture_status_guard(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.capture_status_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_user boolean := current_user in ('authenticated', 'anon');
  v_rpc  boolean := coalesce(current_setting('app.via_rpc', true), '') = 'on';
  v_from text := case when tg_op = 'UPDATE' then old.status end;
  v_ok   boolean;
begin
  if tg_op = 'INSERT' then
    v_ok := new.status = 'uploaded' or not v_user;
  elsif new.status = old.status then
    return new;
  elsif v_user then
    v_ok := v_rpc and (v_from, new.status) in (('failed', 'uploaded'), ('needs_confirmation', 'done'));
  else
    v_ok := (v_from, new.status) in (
      ('uploaded', 'processing'),
      ('processing', 'needs_confirmation'), ('processing', 'done'),
      ('processing', 'uploaded'), ('processing', 'failed'),
      ('failed', 'uploaded'), ('needs_confirmation', 'done'));
  end if;
  if not v_ok then
    perform app.err('INVALID_TRANSITION',
                    jsonb_build_object('capture_id', new.id, 'from', v_from, 'to', new.status));
  end if;
  return new;
end $$;

--
-- Name: check_patch_keys(jsonb, text[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.check_patch_keys(p_patch jsonb, p_allowed text[]) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  v_bad text[];
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'patch_must_be_object'));
  end if;
  select array_agg(k order by k) into v_bad from jsonb_object_keys(p_patch) k where not (k = any (p_allowed));
  if v_bad is not null then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'unknown_keys', 'keys', to_jsonb(v_bad)));
  end if;
end $$;

--
-- Name: check_product_merge(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.check_product_merge() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status = 'merged' and old.status is distinct from 'merged' then
    if not exists (select 1 from public.product where id = new.merged_into_id and status = 'active') then
      raise exception 'Target merge % harus produk aktif', new.merged_into_id;
    end if;
  end if;
  return new;
end $$;

--
-- Name: job; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.job (
    id bigint NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT job_kind_check CHECK ((kind = ANY (ARRAY['recompute_unit_price'::text, 'promote_aliases'::text, 'purge_images'::text, 'redact_ocr'::text, 'delete_household'::text, 'share_existing_prices'::text, 'purge_storage_paths'::text]))),
    CONSTRAINT job_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text])))
);

--
-- Name: claim_job(text[], integer); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.claim_job(p_kinds text[], p_lease_seconds integer DEFAULT 300) RETURNS SETOF app.job
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return query
  update app.job j
     set status = 'running', attempts = j.attempts + 1,
         run_after = now() + make_interval(secs => p_lease_seconds)
   where j.id = (select x.id from app.job x
                  where x.status = 'pending' and x.run_after <= now() and x.kind = any (p_kinds)
                  order by x.run_after, x.id
                  limit 1 for update skip locked)
  returning j.*;
end $$;

--
-- Name: claim_next_capture(text, text, text, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.claim_next_capture(p_worker text, p_engine text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_prompt_version text DEFAULT NULL::text) RETURNS TABLE(capture_id uuid, run_id uuid, kind text, household_id uuid, attempt integer, store_id uuid, branch_id uuid, shopping_session_id uuid, uploaded_at timestamp with time zone, captured_at timestamp with time zone, images jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_backoff jsonb := app.config_json('capture_retry_backoff_seconds');
  v_c       public.capture;
  v_round   record;
  v_run     uuid;
begin
  select c.* into v_c
    from public.capture c
    cross join lateral app.capture_round_runs(c.id) rr
   where c.status = 'uploaded'
     and (rr.n = 0
          or rr.last_finished <= now() - make_interval(secs =>
               (v_backoff ->> (least(rr.n, jsonb_array_length(v_backoff)) - 1))::integer))
   order by c.uploaded_at, c.id
   limit 1
     for update of c skip locked;
  if v_c.id is null then
    return;
  end if;
  select * into v_round from app.capture_round_runs(v_c.id);

  update public.capture set status = 'processing', error_message = null, error_code = null where id = v_c.id;
  insert into public.processing_run (capture_id, household_id, status, ocr_engine, ai_model, prompt_version)
  values (v_c.id, v_c.household_id, 'running', p_engine, p_model, coalesce(p_prompt_version, p_worker))
  returning id into v_run;

  capture_id := v_c.id; run_id := v_run; kind := v_c.kind; household_id := v_c.household_id;
  attempt := v_round.n + 1; store_id := v_c.store_id; branch_id := v_c.branch_id;
  shopping_session_id := v_c.shopping_session_id; uploaded_at := v_c.uploaded_at; captured_at := v_c.captured_at;
  select coalesce(jsonb_agg(jsonb_build_object('position', i.position, 'storage_path', i.storage_path,
                                               'sha256', i.sha256, 'byte_size', i.byte_size) order by i.position), '[]')
    into images from public.capture_image i where i.capture_id = v_c.id;
  return next;
end $$;

--
-- Name: complete_job(bigint, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.complete_job(p_job_id bigint, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update app.job set status = 'done', finished_at = now(), last_error = p_note
   where id = p_job_id and status = 'running'
$$;

--
-- Name: compute_unit_price(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.compute_unit_price() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_mode   text;
  v_pack   integer;
  v_size   numeric;
  v_factor numeric;
begin
  select p.sale_mode, p.pack_count, p.content_size, u.to_base_factor
    into v_mode, v_pack, v_size, v_factor
    from public.product p
    join public.unit u on u.code = p.content_unit
   where p.id = new.product_id;

  new.unit_price := case v_mode
    when 'unit'   then new.effective_price / (v_pack * v_size * v_factor)
    when 'weight' then new.effective_price / v_factor
  end;
  return new;
end $$;

--
-- Name: config_int(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.config_int(p_key text) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$ select (value #>> '{}')::integer from app.config where key = p_key $$;

--
-- Name: config_json(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.config_json(p_key text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ select value from app.config where key = p_key $$;

--
-- Name: config_numeric(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.config_numeric(p_key text) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ select (value #>> '{}')::numeric from app.config where key = p_key $$;

--
-- Name: default_visibility(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.default_visibility() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  new.visibility := case
    when (select h.share_prices_public from public.household h where h.id = new.household_id)
    then 'public' else 'private' end;
  return new;
end $$;

--
-- Name: derive_receipt_price(uuid, uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.derive_receipt_price(p_line_id uuid, p_product_id uuid) RETURNS TABLE(household_id uuid, capture_id uuid, transaction_date date, store_id uuid, branch_id uuid, currency character, quantity numeric, actual_weight numeric, normal_price numeric, promo_price numeric, effective_price numeric, price_basis text, member_hint jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_line   public.receipt_line;
  v_rcpt   public.receipt;
  v_mode   text;
  v_q0     numeric;
  v_base   numeric;
  v_disc   numeric;
  v_void   numeric;
  v_voidq  numeric;
  v_hint   text;
  v_prog   uuid;
  v_q      numeric;
  v_neto   numeric;
  v_eff    numeric;
begin
  select * into v_line from public.receipt_line where id = p_line_id;
  if v_line.id is null or v_line.line_type <> 'product' then
    return;
  end if;
  select * into v_rcpt from public.receipt where id = v_line.receipt_id;
  select p.sale_mode into v_mode from public.product p where p.id = p_product_id;
  if v_mode is null then
    return;
  end if;

  v_q0   := coalesce(v_line.quantity,
                     case when v_mode = 'weight' and v_line.unit_amount > 0
                          then v_line.line_amount / v_line.unit_amount end,
                     1);
  v_base := coalesce(v_line.unit_amount, round(v_line.line_amount / v_q0, 2));

  select coalesce(sum(a.line_amount) filter (where a.line_type = 'discount'), 0),
         coalesce(sum(a.line_amount) filter (where a.line_type = 'void'), 0),
         coalesce(sum(coalesce(a.quantity, abs(a.line_amount) / nullif(v_base, 0)))
                    filter (where a.line_type = 'void'), 0),
         min(a.raw_text) filter (where a.line_type = 'discount'
                                   and app.normalize_text(a.raw_text) ~ '\mmember\M')
    into v_disc, v_void, v_voidq, v_hint
    from public.receipt_line a
   where a.applies_to_line_id = v_line.id;

  v_q    := v_q0 - v_voidq;
  v_neto := v_line.line_amount + v_disc + v_void;
  if v_q <= 0 or v_neto <= 0 then
    return;                                                    -- Q-18: tanpa record
  end if;
  v_eff := round(v_neto / v_q, 2);

  if v_hint is not null then
    select min(mp.id::text)::uuid into v_prog
      from public.member_program mp
     where mp.store_id = v_rcpt.store_id and mp.status = 'active'
    having count(*) = 1;
  end if;

  household_id     := v_line.household_id;
  capture_id       := v_rcpt.capture_id;
  transaction_date := v_rcpt.transaction_date;
  store_id         := v_rcpt.store_id;
  branch_id        := v_rcpt.branch_id;
  currency         := v_rcpt.currency;
  quantity         := case when v_mode = 'weight' then 1 else v_q end;
  actual_weight    := case when v_mode = 'weight' then v_q end;
  normal_price     := v_base;
  price_basis      := case when v_disc < 0 and v_eff < v_base then 'promo' else 'normal' end;
  promo_price      := case when price_basis = 'promo' then v_eff end;
  effective_price  := v_eff;
  member_hint      := case when v_hint is not null then
                        jsonb_strip_nulls(jsonb_build_object('text', v_hint, 'program_id', v_prog)) end;
  return next;
end $$;

--
-- Name: detach_public_facts(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.detach_public_facts(p_household uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_n integer;
begin
  delete from app.public_price_source s
   using public.price_record pr
   where pr.id = s.price_record_id and pr.household_id = p_household;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

--
-- Name: enforce_ref_visibility(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.enforce_ref_visibility() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_row   jsonb := to_jsonb(new);
  v_owner uuid  := case when tg_argv[0] = '' then null else (v_row ->> tg_argv[0])::uuid end;
  v_pair  text;
  v_col   text;
  v_tbl   text;
  v_ref   uuid;
  v_ok    boolean;
begin
  foreach v_pair in array tg_argv[1:] loop
    v_col := split_part(v_pair, ':', 1);
    v_tbl := split_part(v_pair, ':', 2);
    v_ref := (v_row ->> v_col)::uuid;
    continue when v_ref is null;

    execute format(
      'select exists (select 1 from public.%I where id = $1 and (household_id is null or household_id = $2))',
      v_tbl)
    into v_ok using v_ref, v_owner;

    if not v_ok then
      raise exception 'Referensi %.% = % tidak terlihat oleh pemilik baris ini', tg_table_name, v_col, v_ref
        using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end $_$;

--
-- Name: enqueue_retention(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.enqueue_retention() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_img  integer := 0;
  v_ocr  integer := 0;
  v_hh   integer := 0;
  v_ids  jsonb;
begin
  -- Gambar jatuh tempo (batch 500 per job), belum ada di job aktif.
  loop
    select jsonb_agg(id) into v_ids from (
      select ci.id from public.capture_image ci
       where ci.purge_after < now() and ci.purged_at is null
         and not exists (select 1 from app.job j where j.kind = 'purge_images' and j.status in ('pending', 'running')
                          and j.payload -> 'image_ids' ? ci.id::text)
       order by ci.purge_after limit 500) x;
    exit when v_ids is null;
    insert into app.job (kind, payload) values ('purge_images', jsonb_build_object('image_ids', v_ids));
    v_img := v_img + jsonb_array_length(v_ids);
  end loop;

  -- Teks OCR mentah: N hari setelah capture final (done/failed).
  loop
    select jsonb_agg(id) into v_ids from (
      select r.id from public.processing_run r
        join public.capture c on c.id = r.capture_id
       where r.pii_redacted_at is null and r.status <> 'running'
         and (r.raw_ocr_text is not null or r.raw_ai_output is not null)
         and c.status in ('done', 'failed')
         and coalesce(c.processed_at, r.finished_at) < now() - make_interval(days => app.config_numeric('ocr_redact_after_days')::integer)
         and not exists (select 1 from app.job j where j.kind = 'redact_ocr' and j.status in ('pending', 'running')
                          and j.payload -> 'run_ids' ? r.id::text)
       order by r.finished_at limit 500) x;
    exit when v_ids is null;
    insert into app.job (kind, payload) values ('redact_ocr', jsonb_build_object('run_ids', v_ids));
    v_ocr := v_ocr + jsonb_array_length(v_ids);
  end loop;

  -- Jaring pengaman hapus akun (§7.6): household tanpa anggota > 1 jam.
  with ins as (
    insert into app.job (kind, payload)
    select 'delete_household', jsonb_build_object('household_id', h.id)
      from public.household h
     where coalesce(h.archived_at, h.created_at) < now() - interval '1 hour'
       and not exists (select 1 from public.household_member m where m.household_id = h.id)
       and not exists (select 1 from app.job j where j.kind = 'delete_household' and j.status in ('pending', 'running')
                        and j.payload ->> 'household_id' = h.id::text)
    returning 1)
  select count(*) into v_hh from ins;

  return jsonb_build_object('purge_images', v_img, 'redact_ocr', v_ocr, 'delete_household', v_hh);
end $$;

--
-- Name: enqueue_storage_purge(uuid, text[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.enqueue_storage_purge(p_household uuid, p_paths text[]) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_id bigint;
begin
  if (select auth.uid()) is not null and p_household not in (select app.my_household_ids()) then
    perform app.err('FORBIDDEN', jsonb_build_object('household_id', p_household));
  end if;
  if exists (select 1 from unnest(p_paths) p where split_part(p, '/', 1) <> p_household::text) then
    perform app.err('FORBIDDEN', jsonb_build_object('reason', 'path_outside_household'));
  end if;
  if coalesce(cardinality(p_paths), 0) = 0 then
    return null;
  end if;
  insert into app.job (kind, payload)
  values ('purge_storage_paths', jsonb_build_object('household_id', p_household, 'paths', to_jsonb(p_paths)))
  returning id into v_id;
  return v_id;
end $$;

--
-- Name: enqueue_summary_refresh(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.enqueue_summary_refresh() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    insert into app.summary_refresh_queue (household_id, product_id)
    values (old.household_id, old.product_id) on conflict do nothing;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into app.summary_refresh_queue (household_id, product_id)
    values (new.household_id, new.product_id) on conflict do nothing;
  end if;
  return null;
end $$;

--
-- Name: enqueue_time_based_refresh(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.enqueue_time_based_refresh() RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with ins as (
    insert into app.summary_refresh_queue (household_id, product_id)
    select household_id, product_id
      from public.price_summary
     where as_of_date < current_date
       and (   best_90d_date <= current_date - app.config_int('best_price_window_days')
            or trend_direction is not null
            or last_transaction_date > current_date - 2 * app.config_int('trend_window_days'))
    on conflict do nothing
    returning 1)
  select count(*)::integer from ins
$$;

--
-- Name: enqueue_unit_price_recompute(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.enqueue_unit_price_recompute() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into app.job (kind, payload)
  values ('recompute_unit_price', jsonb_build_object('product_id', new.id));
  return null;
end $$;

--
-- Name: err(text, jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.err(p_code text, p_detail jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_http text;
  v_hint text;
begin
  select e.http, e.hint into v_http, v_hint
    from (values
      ('NOT_FOUND',                   '404', 'Data tidak ditemukan.'),
      ('STALE_WRITE',                 '409', 'Data sudah diubah di tempat lain. Muat ulang lalu coba lagi.'),
      ('INVALID_STATE',               '409', 'Status data tidak mengizinkan aksi ini.'),
      ('INVALID_TRANSITION',          '409', 'Perubahan status ini tidak diizinkan.'),
      ('DUPLICATE_DECISION_REQUIRED', '409', 'Struk ini mirip struk lain. Pilih: simpan sebagai struk berbeda atau buang.'),
      ('SESSION_NOT_ACTIVE',          '409', 'Sesi belanja sudah berakhir.'),
      ('RECEIPT_STORE_REQUIRED',      '422', 'Pilih toko untuk struk ini.'),
      ('UNDECIDED_LINES',             '422', 'Masih ada baris yang belum diputuskan.'),
      ('STORE_REQUIRED',              '422', 'Pilih toko untuk harga ini.'),
      ('NO_APPLICABLE_PRICE',         '422', 'Tidak ada harga yang berlaku. Isi harga normal.'),
      ('USE_RECEIPT_LINE',            '422', 'Harga dari struk diubah lewat baris struknya.'),
      ('RECEIPT_DERIVED_FIELD',       '422', 'Angka harga dari struk diturunkan dari baris struk dan tidak bisa diubah langsung.'),
      ('INVALID_EXTRA',               '422', 'Info tambahan tidak valid.'),
      ('CAPTURE_IMAGES_MISSING',      '422', 'Gambar belum selesai diunggah.'),
      ('BRANCH_CLOSED',               '422', 'Cabang ini sudah tutup.'),
      ('RECORDS_NOT_OWNED',           '403', 'Sebagian data bukan milikmu.'),
      ('MERGE_FORBIDDEN',             '403', 'Produk ini tidak bisa digabungkan.'),
      ('REAUTH_REQUIRED',             '401', 'Masuk ulang dulu untuk melanjutkan.'),
      ('FORBIDDEN',                   '403', 'Tidak berhak melakukan aksi ini.'),
      ('INVALID_INPUT',               '400', 'Input tidak valid.'),
      ('AI_QUOTA_EXCEEDED',           '429', 'Batas pertanyaan Tanya sudah tercapai. Coba lagi nanti.'),
      ('AI_UNAVAILABLE',              '503', 'Layanan AI sedang tidak tersedia.')
    ) as e(code, http, hint)
   where e.code = p_code;

  if v_http is null then
    raise exception 'Kode error tidak dikenal: %', p_code;
  end if;

  raise exception using
    errcode = 'PT' || v_http,
    message = p_code,
    detail  = coalesce(p_detail, '{}'::jsonb)::text,
    hint    = v_hint;
end $$;

--
-- Name: fail_job(bigint, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.fail_job(p_job_id bigint, p_error text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update app.job set status = 'failed', finished_at = now(), last_error = p_error
   where id = p_job_id and status = 'running'
$$;

--
-- Name: fail_run(uuid, text, text, boolean); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.fail_run(p_run_id uuid, p_error_code text, p_message text, p_transient boolean) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_run   public.processing_run;
  v_c     public.capture;
  v_round record;
  v_max   integer := app.config_numeric('capture_max_attempts')::integer;
begin
  select * into v_run from public.processing_run where id = p_run_id for update;
  if v_run.id is null or v_run.status <> 'running' then
    return 'stale';
  end if;
  select * into v_c from public.capture where id = v_run.capture_id for update;
  update public.processing_run set status = 'failed', finished_at = now(), error_message = p_message
   where id = v_run.id;

  if v_c.status <> 'processing'
     or exists (select 1 from public.processing_run r where r.capture_id = v_c.id and r.started_at > v_run.started_at) then
    return 'stale';
  end if;
  select * into v_round from app.capture_round_runs(v_c.id);
  if p_transient and v_round.n < v_max then
    update public.capture set status = 'uploaded', error_message = p_message, error_code = null where id = v_c.id;
    return 'uploaded';
  end if;
  update public.capture
     set status = 'failed', error_message = p_message, processed_at = now(),
         error_code = case when p_error_code in ('blurry', 'not_a_receipt', 'unsupported', 'timeout', 'other')
                           then p_error_code else 'other' end
   where id = v_c.id;
  return 'failed';
end $$;

--
-- Name: finish_household_deletion(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.finish_household_deletion(p_household uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if exists (select 1 from public.household_member where household_id = p_household) then
    return false;
  end if;
  perform app.detach_public_facts(p_household);
  delete from public.household where id = p_household;
  -- Cascade price_record mengantrekan ringkasan household yang sudah tidak ada.
  delete from app.summary_refresh_queue where household_id = p_household;
  return true;
end $$;

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_household uuid;
begin
  insert into public.profile (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));

  insert into public.household (name)
  values (coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'Rumah'))
  returning id into v_household;

  insert into public.household_member (household_id, user_id, role)
  values (v_household, new.id, 'owner');
  return new;
end $$;

--
-- Name: household_today(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.household_today(p_household uuid) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select (now() at time zone coalesce((select timezone from public.household where id = p_household),
                                      'Asia/Jakarta'))::date
$$;

--
-- Name: images_to_purge(uuid[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.images_to_purge(p_image_ids uuid[]) RETURNS TABLE(id uuid, storage_path text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select ci.id, ci.storage_path from public.capture_image ci
   where ci.id = any (p_image_ids) and ci.purged_at is null
   order by ci.storage_path
$$;

--
-- Name: jsonb_value_eq(jsonb, jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.jsonb_value_eq(a jsonb, b jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$
  select case
    when a is null or a = 'null'::jsonb then b is null or b = 'null'::jsonb
    when b is null or b = 'null'::jsonb then false
    when jsonb_typeof(a) = 'number' and jsonb_typeof(b) = 'number'
      then (a #>> '{}')::numeric = (b #>> '{}')::numeric
    else a = b end
$$;

--
-- Name: mark_images_purged(uuid[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.mark_images_purged(p_image_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_n integer;
begin
  update public.capture_image set purged_at = now() where id = any (p_image_ids) and purged_at is null;
  get diagnostics v_n = row_count;
  update public.receipt r set pii = '{}'
   where r.pii <> '{}'
     and r.capture_id in (select capture_id from public.capture_image where id = any (p_image_ids))
     and not exists (select 1 from public.capture_image ci where ci.capture_id = r.capture_id and ci.purged_at is null);
  return v_n;
end $$;

--
-- Name: mark_rpc(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.mark_rpc() RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$ select set_config('app.via_rpc', 'on', true); $$;

--
-- Name: match_member_program(uuid, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.match_member_program(p_store uuid, p_name text) RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select mp.id from public.member_program mp
   where p_store is not null and mp.store_id = p_store
     and (app.normalize_text(mp.name) = app.normalize_text(p_name)
          or (p_name is null
              and (select count(*) from public.member_program x where x.store_id = p_store and x.status = 'active') = 1
              and mp.status = 'active'))
   order by mp.id
   limit 1
$$;

--
-- Name: match_products(uuid, uuid, jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.match_products(p_household uuid, p_store_id uuid, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_item   jsonb;
  v_out    jsonb := '[]';
  v_text   text;
  v_date   date;
  v_min    numeric := app.config_numeric('fuzzy_min_similarity');
  v_cands  jsonb;
  v_best   jsonb;
  v_group  uuid := (select store_group_id from public.store where id = p_store_id);
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_text := app.normalize_text(v_item ->> 'raw_text');
    v_date := coalesce((v_item ->> 'date')::date, app.household_today(p_household));

    with
    -- Tier 1: barcode berlaku pada tanggal transaksi. GTIN: household dulu, lalu global.
    -- PLU: wajib store yang sama. Produk merged → ikuti merged_into_id (F-01).
    t1 as (
      select coalesce(p.merged_into_id, p.id) as product_id, 'barcode'::text as tier, 1.000::numeric as confidence,
             1 as prio, (ba.household_id is null)::int as sub
        from public.barcode_assignment ba
        join public.product p on p.id = ba.product_id
       where nullif(btrim(v_item ->> 'barcode'), '') is not null
         and ba.code = btrim(v_item ->> 'barcode')
         and (ba.household_id is null or ba.household_id = p_household)
         and ba.valid_from <= v_date and (ba.valid_until is null or ba.valid_until > v_date)
         and (ba.code_type = 'gtin' or ba.store_id = p_store_id)),
    -- Tier 2: alias exact per store; household menang atas global (D-35).
    t2 as (
      select a.product_id, 'alias'::text, case when a.household_id is null then 0.950 else 0.980 end,
             2, (a.household_id is null)::int
        from public.product_alias a
       where v_text is not null and a.status = 'active' and a.store_id = p_store_id
         and a.normalized_text = v_text
         and (a.household_id is null or a.household_id = p_household)),
    -- Tier 2b: alias dari store lain dalam store_group yang sama → kandidat saja (A-6).
    t2b as (
      select a.product_id, 'alias'::text, 0.700::numeric, 3, (a.household_id is null)::int
        from public.product_alias a
        join public.store s on s.id = a.store_id
       where v_text is not null and v_group is not null and s.store_group_id = v_group
         and a.store_id <> p_store_id and a.status = 'active' and a.normalized_text = v_text
         and (a.household_id is null or a.household_id = p_household)),
    -- Tier 3: fuzzy word_similarity terhadap nama + varian + brand.
    t3 as (
      select p.id, 'fuzzy'::text,
             round(extensions.word_similarity(v_text, p.search_text || ' ' || coalesce(b.normalized_name, ''))::numeric, 3),
             4, 0
        from public.product p
        left join public.brand b on b.id = p.brand_id
       where v_text is not null and p.status = 'active'
         and (p.household_id is null or p.household_id = p_household)
         and extensions.word_similarity(v_text, p.search_text || ' ' || coalesce(b.normalized_name, '')) >= v_min),
    allc as (
      select x.product_id, x.tier, x.confidence, x.prio, x.sub from t1 x
      union all select * from t2 union all select * from t2b union all select * from t3),
    ranked as (
      select distinct on (c.product_id) c.*
        from allc c
        join public.product p on p.id = c.product_id and p.status = 'active'
       order by c.product_id, c.prio, c.sub, c.confidence desc),
    top as (
      select * from ranked order by prio, sub, confidence desc, product_id limit 5)
    select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'tier', tier, 'confidence', confidence)
                              order by prio, sub, confidence desc, product_id), '[]')
      into v_cands from top;

    v_best := v_cands -> 0;
    v_out := v_out || jsonb_build_object(
      'key', v_item -> 'key',
      'product_id', v_best -> 'product_id',
      'tier', v_best -> 'tier',
      'confidence', v_best -> 'confidence',
      'candidates', v_cands);
  end loop;
  return v_out;
end $$;

--
-- Name: missing_storage_paths(uuid, text[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.missing_storage_paths(p_household uuid, p_paths text[]) RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(array_agg(p order by p), '{}')
    from unnest(p_paths) p
   where split_part(p, '/', 1) <> p_household::text
      or ((select auth.uid()) is not null and p_household not in (select app.my_household_ids()))
      or not exists (select 1 from storage.objects o where o.bucket_id = 'captures' and o.name = p)
$$;

--
-- Name: household; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.household (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    default_currency character(3) DEFAULT 'IDR'::bpchar NOT NULL,
    timezone text DEFAULT 'Asia/Jakarta'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    share_prices_public boolean DEFAULT false NOT NULL,
    CONSTRAINT household_default_currency_check CHECK ((default_currency ~ '^[A-Z]{3}$'::text))
);

--
-- Name: my_household(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.my_household() RETURNS public.household
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select h.* from public.household h
   where h.id in (select app.my_household_ids())
   order by h.created_at, h.id
   limit 1
$$;

--
-- Name: my_household_ids(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.my_household_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select household_id from public.household_member where user_id = (select auth.uid())
$$;

--
-- Name: normalize_text(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.normalize_text(t text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ select nullif(lower(regexp_replace(btrim(t), '\s+', ' ', 'g')), '') $$;

--
-- Name: observation_price(uuid, date, numeric, numeric, date, date, numeric, uuid, boolean); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.observation_price(p_household uuid, p_date date, p_normal numeric, p_promo numeric, p_promo_from date, p_promo_until date, p_member numeric, p_member_program uuid, p_member_eligible boolean DEFAULT NULL::boolean) RETURNS TABLE(effective_price numeric, price_basis text, member_eligible boolean, reason text)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_eligible boolean;
begin
  v_eligible := case
    when p_member is null or p_member_program is null then null
    when p_member_eligible is not null then p_member_eligible
    else exists (select 1 from public.household_program_membership m
                  where m.household_id = p_household and m.member_program_id = p_member_program) end;

  select c.price, c.basis into effective_price, price_basis
    from (values (p_normal, 'normal', 1),
                 (case when p_promo is not null
                        and (p_promo_from is null or p_date >= p_promo_from)
                        and (p_promo_until is null or p_date <= p_promo_until) then p_promo end, 'promo', 2),
                 (case when v_eligible then p_member end, 'member', 3)) c(price, basis, ord)
   where c.price is not null
   order by c.price, c.ord
   limit 1;

  member_eligible := v_eligible;
  reason := case when effective_price is null then 'no_applicable_price' end;
  return next;
end $$;

--
-- Name: orphan_storage_objects(integer); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.orphan_storage_objects(p_limit integer DEFAULT 500) RETURNS TABLE(name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select o.name from storage.objects o
   where o.bucket_id = 'captures'
     and o.created_at < now() - make_interval(hours => app.config_numeric('orphan_upload_ttl_hours')::integer)
     and not exists (select 1 from public.capture_image ci where ci.storage_path = o.name)
   order by o.created_at
   limit p_limit
$$;

--
-- Name: prepare_household_deletion(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.prepare_household_deletion(p_household uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (select 1 from public.household where id = p_household) then
    return 'gone';
  end if;
  if exists (select 1 from public.household_member where household_id = p_household) then
    return 'has_members';
  end if;
  perform app.detach_public_facts(p_household);         -- fakta anonim tetap ada (Q-06)
  return 'ready';
end $$;

--
-- Name: price_point(uuid, numeric, numeric, text, date, uuid, uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.price_point(p_record_id uuid, p_effective numeric, p_unit numeric, p_basis text, p_date date, p_store_id uuid, p_branch_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'record_id', p_record_id, 'effective_price', p_effective, 'unit_price', p_unit,
    'price_basis', p_basis,
    'member_program_name', (select mp.name from public.price_record r
                              join public.member_program mp on mp.id = r.member_program_id
                             where r.id = p_record_id and r.price_basis = 'member'),
    'date', p_date, 'store', app.store_json(p_store_id), 'branch', app.branch_json(p_branch_id))
$$;

--
-- Name: price_record_receipt_guard(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.price_record_receipt_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  d       record;
  v_cols  text[] := array['capture_id', 'transaction_date', 'store_id', 'branch_id', 'currency',
                          'quantity', 'actual_weight', 'normal_price', 'promo_price', 'promo_min_qty',
                          'promo_valid_from', 'promo_valid_until', 'member_price', 'member_program_id',
                          'effective_price', 'price_basis'];
  v_new   jsonb;
  v_old   jsonb;
  v_want  jsonb;
  v_col   text;
begin
  if new.source_type <> 'receipt' then
    return new;
  end if;

  select * into d from app.derive_receipt_price(new.receipt_line_id, new.product_id);
  if not found then
    perform app.err('RECEIPT_DERIVED_FIELD',
                    jsonb_build_object('receipt_line_id', new.receipt_line_id, 'reason', 'no_record'));
  end if;

  v_want := jsonb_build_object(
    'capture_id', d.capture_id, 'transaction_date', d.transaction_date, 'store_id', d.store_id,
    'branch_id', d.branch_id, 'currency', d.currency, 'quantity', d.quantity,
    'actual_weight', d.actual_weight, 'normal_price', d.normal_price, 'promo_price', d.promo_price,
    'promo_min_qty', null, 'promo_valid_from', null, 'promo_valid_until', null,
    'member_price', null, 'member_program_id', null,
    'effective_price', d.effective_price, 'price_basis', d.price_basis);
  v_new := to_jsonb(new);
  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) end;

  foreach v_col in array v_cols loop
    if (tg_op = 'INSERT' or (v_new -> v_col) is distinct from (v_old -> v_col))
       and not app.jsonb_value_eq(v_new -> v_col, v_want -> v_col) then
      perform app.err('RECEIPT_DERIVED_FIELD',
                      jsonb_build_object('receipt_line_id', new.receipt_line_id, 'column', v_col,
                                         'expected', v_want -> v_col, 'got', v_new -> v_col));
    end if;
  end loop;

  new.capture_id        := d.capture_id;
  new.transaction_date  := d.transaction_date;
  new.store_id          := d.store_id;
  new.branch_id         := d.branch_id;
  new.currency          := d.currency;
  new.quantity          := d.quantity;
  new.actual_weight     := d.actual_weight;
  new.normal_price      := d.normal_price;
  new.promo_price       := d.promo_price;
  new.promo_min_qty     := null;
  new.promo_valid_from  := null;
  new.promo_valid_until := null;
  new.member_price      := null;
  new.member_program_id := null;
  new.effective_price   := d.effective_price;
  new.price_basis       := d.price_basis;
  return new;
end $$;

--
-- Name: process_summary_queue(integer); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.process_summary_queue(p_limit integer DEFAULT 500) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_item record;
  v_n    integer := 0;
begin
  for v_item in
    delete from app.summary_refresh_queue q
     where (q.household_id, q.product_id) in (
       select household_id, product_id from app.summary_refresh_queue
        order by enqueued_at limit p_limit for update skip locked)
    returning q.household_id, q.product_id
  loop
    perform app.refresh_price_summary(v_item.household_id, v_item.product_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

--
-- Name: product_card(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.product_card(p_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'product', app.product_lite(p.id),
    'group', case when g.id is null then null else jsonb_build_object(
      'id', g.id, 'name', g.name,
      'best_by_dimension', (
        select jsonb_build_object('unit_price', s2.best_90d_unit_price, 'product_id', s2.product_id)
          from public.product p2
          join public.unit u2 on u2.code = p2.content_unit
          join public.price_summary s2 on s2.product_id = p2.id
         where p2.product_group_id = g.id and p2.status = 'active' and u2.dimension = u.dimension
           and s2.best_90d_unit_price is not null
         order by s2.best_90d_unit_price, p2.id
         limit 1)) end,
    'summary', case when s.product_id is null then null else jsonb_build_object(
      'record_count', s.record_count,
      'last_transaction_date', s.last_transaction_date,
      'last_effective_price', s.last_effective_price,
      'last_unit_price', s.last_unit_price,
      'best_90d', case when s.best_90d_record_id is null then null else
        app.price_point(s.best_90d_record_id, s.best_90d_effective_price, s.best_90d_unit_price,
                        s.best_90d_price_basis, s.best_90d_date, s.best_90d_store_id, s.best_90d_branch_id) end,
      'best_all', app.price_point(s.best_all_record_id, s.best_all_effective_price, s.best_all_unit_price,
                                  s.best_all_price_basis, s.best_all_date, s.best_all_store_id, s.best_all_branch_id),
      'trend_direction', s.trend_direction,
      'trend_pct', s.trend_pct,
      'refreshed_at', s.refreshed_at) end,
    'hints', jsonb_build_object(
      'member_not_counted', (                                        -- X-07
        select jsonb_build_object('member_price', r.member_price, 'program_name', mp.name,
                                  'store_name', st.name, 'record_id', r.id, 'date', r.transaction_date)
          from public.price_record r
          join public.member_program mp on mp.id = r.member_program_id
          join public.store st on st.id = r.store_id
         where r.product_id = p.id and r.status = 'active'
           and r.member_price is not null and r.price_basis <> 'member'
         order by r.transaction_date desc, r.created_at desc
         limit 1),
      'bundle_only_count', (select count(*) from public.price_record r
                             where r.product_id = p.id and r.status = 'active' and r.is_bundle)))
    from public.product p
    join public.unit u on u.code = p.content_unit
    left join public.product_group g on g.id = p.product_group_id
    left join public.price_summary s on s.product_id = p.id
   where p.id = p_id
$$;

--
-- Name: product_lite(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.product_lite(p_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'variant', p.variant, 'sale_mode', p.sale_mode,
    'pack_count', p.pack_count, 'content_size', p.content_size, 'content_unit', p.content_unit,
    'dimension', u.dimension, 'base_unit', app.base_unit(u.dimension),
    'is_private', p.household_id is not null, 'status', p.status,
    'product_group_id', p.product_group_id, 'merged_into_id', p.merged_into_id,
    'brand_name', b.name, 'category_name', c.name)
    from public.product p
    join public.unit u on u.code = p.content_unit
    left join public.brand b on b.id = p.brand_id
    left join public.category c on c.id = p.category_id
   where p.id = p_id
$$;

--
-- Name: promote_aliases(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.promote_aliases() RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with candidate as (
    select a.store_id, a.normalized_text,
           min(a.alias_text)              as alias_text,
           (array_agg(a.product_id))[1]   as product_id
      from public.product_alias a
      join public.product p on p.id = a.product_id
     where a.household_id is not null and a.status = 'active'
     group by a.store_id, a.normalized_text
    having count(distinct a.product_id) = 1                                   -- tanpa pemetaan tandingan
       and count(distinct a.household_id) >= app.config_int('alias_promotion_threshold')
       and bool_and(p.household_id is null)                                   -- hanya produk global
  ), ins as (
    insert into public.product_alias (household_id, store_id, product_id, alias_text, promoted_at)
    select null, c.store_id, c.product_id, c.alias_text, now()
      from candidate c
     where not exists (
       select 1 from public.product_alias g
        where g.household_id is null and g.status = 'active'
          and g.store_id = c.store_id and g.normalized_text = c.normalized_text)
    returning 1)
  select count(*)::integer from ins
$$;

--
-- Name: propagate_receipt_header(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.propagate_receipt_header() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.price_record pr
     set transaction_date = new.transaction_date,
         store_id         = new.store_id,
         branch_id        = new.branch_id,
         currency         = new.currency
    from public.receipt_line rl
   where rl.receipt_id = new.id
     and pr.receipt_line_id = rl.id;
  return null;
end $$;

--
-- Name: reap_stale_runs(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.reap_stale_runs() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_run uuid;
  v_n   integer := 0;
begin
  for v_run in
    select r.id from public.processing_run r
     where r.status = 'running'
       and r.started_at < now() - make_interval(secs => app.config_numeric('capture_processing_timeout_seconds')::integer)
     for update skip locked
  loop
    perform app.fail_run(v_run, 'timeout', 'Waktu pemrosesan habis.', true);
    v_n := v_n + 1;
  end loop;

  update app.job set status = 'pending', last_error = coalesce(last_error, 'lease habis')
   where status = 'running' and run_after < now();
  return v_n;
end $$;

--
-- Name: receipt_duplicate(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.receipt_duplicate(p_receipt_id uuid) RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  -- D-20: duplikat jika ditandai worker, atau sidik jari toko + tanggal + total sama.
  select coalesce(
    (select r.duplicate_of_receipt_id from public.receipt r where r.id = p_receipt_id),
    (select o.id from public.receipt r
       join public.receipt o on o.household_id = r.household_id and o.id <> r.id
                            and o.store_id = r.store_id and o.transaction_date = r.transaction_date
                            and o.total_amount = r.total_amount and o.status <> 'discarded'
      where r.id = p_receipt_id and r.store_id is not null
      order by o.created_at limit 1))
$$;

--
-- Name: receipt_line_derive(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.receipt_line_derive() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_targets uuid[];
  v_t       uuid;
  v_rec     public.price_record;
  v_type    text;
  d         record;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_targets := array[new.id, new.applies_to_line_id];
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_targets := v_targets || array[old.id, old.applies_to_line_id];
  end if;

  for v_t in select distinct x from unnest(v_targets) x where x is not null loop
    select * into v_rec from public.price_record where receipt_line_id = v_t;
    continue when v_rec.id is null;
    select line_type into v_type from public.receipt_line where id = v_t;
    continue when v_type is null;                      -- baris terhapus: record ikut cascade

    select * into d from app.derive_receipt_price(v_t, v_rec.product_id);
    if v_type <> 'product' or not found then
      delete from public.price_record where id = v_rec.id;
    elsif (v_rec.quantity, v_rec.actual_weight, v_rec.normal_price, v_rec.promo_price,
           v_rec.effective_price, v_rec.price_basis)
          is distinct from (d.quantity, d.actual_weight, d.normal_price, d.promo_price,
                            d.effective_price, d.price_basis) then
      update public.price_record
         set quantity = d.quantity, actual_weight = d.actual_weight,
             normal_price = d.normal_price, promo_price = d.promo_price,
             effective_price = d.effective_price, price_basis = d.price_basis
       where id = v_rec.id;
    end if;
  end loop;
  return null;
end $$;

--
-- Name: recompute_unit_prices(uuid, integer); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.recompute_unit_prices(p_product uuid, p_batch integer DEFAULT 5000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_n integer;
begin
  with batch as (
    select pr.id from public.price_record pr
      join public.product p on p.id = pr.product_id
      join public.unit u on u.code = p.content_unit
     where pr.product_id = p_product
       and pr.unit_price is distinct from case p.sale_mode
             when 'unit'   then pr.effective_price / (p.pack_count * p.content_size * u.to_base_factor)
             when 'weight' then pr.effective_price / u.to_base_factor end
     limit p_batch)
  update public.price_record pr set updated_at = now()   -- trigger menghitung ulang unit_price
    from batch where pr.id = batch.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

--
-- Name: record_run_output(uuid, text, jsonb, integer, integer, numeric); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.record_run_output(p_run_id uuid, p_raw_text text, p_raw_output jsonb, p_input_tokens integer DEFAULT NULL::integer, p_output_tokens integer DEFAULT NULL::integer, p_cost_usd numeric DEFAULT NULL::numeric) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with u as (
    update public.processing_run
       set raw_ocr_text = p_raw_text, raw_ai_output = p_raw_output,
           input_tokens = p_input_tokens, output_tokens = p_output_tokens, cost_usd = p_cost_usd
     where id = p_run_id and status = 'running'
    returning 1)
  select exists (select 1 from u)
$$;

--
-- Name: refresh_price_summary(uuid, uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.refresh_price_summary(p_household uuid, p_product uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_today   date    := current_date;
  v_window  integer := app.config_int('best_price_window_days');
  v_tw      integer := app.config_int('trend_window_days');
  v_tmin    integer := app.config_int('trend_min_records_per_window');
  v_tflat   numeric := app.config_int('trend_flat_threshold_pct');
  v_count   integer;
  v_last    record;
  v_b90     record;
  v_ball    record;
  v_cur_avg numeric; v_cur_n integer;
  v_prv_avg numeric; v_prv_n integer;
  v_pct     numeric;
  v_dir     text;
  v_cur     char(3);
begin
  -- F-07: hanya mata uang default household (D-68).
  select default_currency into v_cur from public.household where id = p_household;

  select count(*) into v_count
    from public.price_record
   where household_id = p_household and product_id = p_product
     and status = 'active' and not is_bundle and currency = v_cur;

  if v_count = 0 then
    delete from public.price_summary where household_id = p_household and product_id = p_product;
    return;
  end if;

  select * into v_last from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
   order by transaction_date desc, created_at desc limit 1;

  select * into v_ball from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
   order by unit_price asc, transaction_date desc limit 1;

  select * into v_b90 from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
     and transaction_date > v_today - v_window
   order by unit_price asc, transaction_date desc limit 1;

  select avg(unit_price), count(*) into v_cur_avg, v_cur_n from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
     and transaction_date >  v_today - v_tw;
  select avg(unit_price), count(*) into v_prv_avg, v_prv_n from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
     and transaction_date <= v_today - v_tw and transaction_date > v_today - 2 * v_tw;

  if v_cur_n >= v_tmin and v_prv_n >= v_tmin and v_prv_avg > 0 then
    v_pct := round((v_cur_avg - v_prv_avg) / v_prv_avg * 100, 2);
    v_dir := case when v_pct >= v_tflat then 'up' when v_pct <= -v_tflat then 'down' else 'flat' end;
  end if;

  insert into public.price_summary as s (
    household_id, product_id, record_count,
    last_transaction_date, last_effective_price, last_unit_price,
    best_90d_record_id, best_90d_unit_price, best_90d_effective_price, best_90d_price_basis,
    best_90d_date, best_90d_store_id, best_90d_branch_id,
    best_all_record_id, best_all_unit_price, best_all_effective_price, best_all_price_basis,
    best_all_date, best_all_store_id, best_all_branch_id,
    trend_direction, trend_pct, as_of_date, refreshed_at)
  values (
    p_household, p_product, v_count,
    v_last.transaction_date, v_last.effective_price, v_last.unit_price,
    v_b90.id, v_b90.unit_price, v_b90.effective_price, v_b90.price_basis,
    v_b90.transaction_date, v_b90.store_id, v_b90.branch_id,
    v_ball.id, v_ball.unit_price, v_ball.effective_price, v_ball.price_basis,
    v_ball.transaction_date, v_ball.store_id, v_ball.branch_id,
    v_dir, v_pct, v_today, now())
  on conflict (household_id, product_id) do update set
    record_count = excluded.record_count,
    last_transaction_date = excluded.last_transaction_date,
    last_effective_price = excluded.last_effective_price,
    last_unit_price = excluded.last_unit_price,
    best_90d_record_id = excluded.best_90d_record_id,
    best_90d_unit_price = excluded.best_90d_unit_price,
    best_90d_effective_price = excluded.best_90d_effective_price,
    best_90d_price_basis = excluded.best_90d_price_basis,
    best_90d_date = excluded.best_90d_date,
    best_90d_store_id = excluded.best_90d_store_id,
    best_90d_branch_id = excluded.best_90d_branch_id,
    best_all_record_id = excluded.best_all_record_id,
    best_all_unit_price = excluded.best_all_unit_price,
    best_all_effective_price = excluded.best_all_effective_price,
    best_all_price_basis = excluded.best_all_price_basis,
    best_all_date = excluded.best_all_date,
    best_all_store_id = excluded.best_all_store_id,
    best_all_branch_id = excluded.best_all_branch_id,
    trend_direction = excluded.trend_direction,
    trend_pct = excluded.trend_pct,
    as_of_date = excluded.as_of_date,
    refreshed_at = excluded.refreshed_at;
end $$;

--
-- Name: requeue_job(bigint, integer, text, jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.requeue_job(p_job_id bigint, p_delay_seconds integer DEFAULT 0, p_error text DEFAULT NULL::text, p_payload jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update app.job
     set status = 'pending', run_after = now() + make_interval(secs => p_delay_seconds),
         last_error = coalesce(p_error, last_error), payload = coalesce(p_payload, payload)
   where id = p_job_id and status = 'running'
$$;

--
-- Name: require_household(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.require_household() RETURNS public.household
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_h public.household := app.my_household();
begin
  if v_h.id is null then
    perform app.err('FORBIDDEN', jsonb_build_object('reason', 'no_household'));
  end if;
  return v_h;
end $$;

--
-- Name: require_owner(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.require_owner() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_id uuid;
begin
  select m.household_id into v_id
    from public.household_member m
   where m.user_id = (select auth.uid()) and m.role = 'owner'
   order by m.joined_at limit 1;
  if v_id is null then
    perform app.err('FORBIDDEN', jsonb_build_object('reason', 'owner_only'));
  end if;
  return v_id;
end $$;

--
-- Name: resolve_product(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.resolve_product(p_id uuid) RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$ select coalesce(p.merged_into_id, p.id) from public.product p where p.id = p_id $$;

--
-- Name: resolve_store(uuid, text, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.resolve_store(p_household uuid, p_store_name text, p_branch_name text DEFAULT NULL::text) RETURNS TABLE(store_id uuid, branch_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_store  uuid;
  v_branch uuid;
begin
  select s.id into v_store
    from public.store s
   where s.normalized_name = app.normalize_text(p_store_name) and s.status = 'active'
     and (s.household_id is null or s.household_id = p_household)
   order by (s.household_id is null)
   limit 1;
  if v_store is not null and app.normalize_text(p_branch_name) is not null then
    select b.id into v_branch
      from public.branch b
     where b.store_id = v_store and (b.household_id is null or b.household_id = p_household)
       and (app.normalize_text(b.name) = app.normalize_text(p_branch_name)
            or app.normalize_text(b.name) = app.normalize_text(p_store_name || ' ' || p_branch_name))
     order by (b.status = 'open') desc, (b.household_id is null)
     limit 1;
  end if;
  store_id := v_store;
  branch_id := v_branch;
  return next;
end $$;

--
-- Name: run_sql_jobs(integer); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.run_sql_jobs(p_limit integer DEFAULT 50) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_job app.job;
  v_n   integer;
  v_done integer := 0;
begin
  for i in 1 .. p_limit loop
    select * into v_job from app.claim_job(array['recompute_unit_price', 'share_existing_prices'], 300);
    exit when v_job.id is null;
    begin
      if v_job.kind = 'recompute_unit_price' then
        v_n := app.recompute_unit_prices((v_job.payload ->> 'product_id')::uuid, 5000);
        if v_n = 0 then perform app.complete_job(v_job.id); else perform app.requeue_job(v_job.id); end if;
      else
        v_n := app.share_existing_batch((v_job.payload ->> 'household_id')::uuid, 1000);
        if v_n < 0 then
          perform app.complete_job(v_job.id, 'dibatalkan: opt-in publik dimatikan');
        elsif v_n = 0 then
          perform app.complete_job(v_job.id);
        else
          perform app.requeue_job(v_job.id);
        end if;
      end if;
    exception when others then
      if v_job.attempts >= 5 then
        perform app.fail_job(v_job.id, sqlerrm);
      else
        perform app.requeue_job(v_job.id, 60 * v_job.attempts, sqlerrm);
      end if;
    end;
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;

--
-- Name: runs_to_redact(uuid[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.runs_to_redact(p_run_ids uuid[]) RETURNS TABLE(run_id uuid, raw_ocr_text text, raw_ai_output jsonb, pii jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select r.id, r.raw_ocr_text, r.raw_ai_output, coalesce(rc.pii, '{}')
    from public.processing_run r
    left join public.receipt rc on rc.capture_id = r.capture_id
   where r.id = any (p_run_ids) and r.pii_redacted_at is null
$$;

--
-- Name: set_receipt_state(uuid, text, uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.set_receipt_state(p_receipt_id uuid, p_status text, p_duplicate_of uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.receipt
     set status = p_status,
         duplicate_of_receipt_id = p_duplicate_of,
         confirmed_at = case when p_status = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end
   where id = p_receipt_id
     and ((select auth.uid()) is null or household_id in (select app.my_household_ids()));
  if not found then
    perform app.err('NOT_FOUND', jsonb_build_object('receipt_id', p_receipt_id));
  end if;
end $$;

--
-- Name: share_existing_batch(uuid, integer); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.share_existing_batch(p_household uuid, p_limit integer DEFAULT 1000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_on boolean;
  v_n  integer;
begin
  select share_prices_public into v_on from public.household where id = p_household for share;
  if not coalesce(v_on, false) then
    return -1;
  end if;
  update public.price_record set visibility = 'public'
   where id in (select id from public.price_record
                 where household_id = p_household and visibility = 'private' and status = 'active'
                 order by transaction_date desc, id
                 limit p_limit for update skip locked);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

--
-- Name: store_json(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.store_json(p_store_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'channel', s.channel, 'is_private', s.household_id is not null)
    from public.store s where s.id = p_store_id
$$;

--
-- Name: sync_public_fact(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.sync_public_fact() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.public_price_fact f
     using app.public_price_source s
     where s.fact_id = f.id and s.price_record_id = old.id;
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and new.visibility = 'public' and new.status = 'active' and not new.is_bundle
     -- hanya katalog global: produk/toko privat bisa mengungkap identitas
     and exists (select 1 from public.product where id = new.product_id and household_id is null)
     and exists (select 1 from public.store   where id = new.store_id   and household_id is null)
     and (new.branch_id is null
          or exists (select 1 from public.branch where id = new.branch_id and household_id is null))
  then
    with f as (
      insert into public.public_price_fact
        (product_id, store_id, branch_id, transaction_date, currency,
         effective_price, unit_price, price_basis, source_type)
      values
        (new.product_id, new.store_id, new.branch_id, new.transaction_date, new.currency,
         new.effective_price, new.unit_price, new.price_basis, new.source_type)
      returning id)
    insert into app.public_price_source (fact_id, price_record_id)
    select id, new.id from f;
  end if;
  return null;
end $$;

--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end $$;

--
-- Name: unit_price_for(uuid, numeric); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.unit_price_for(p_product_id uuid, p_price numeric) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select case p.sale_mode
           when 'unit'   then p_price / (p.pack_count * p.content_size * u.to_base_factor)
           when 'weight' then p_price / u.to_base_factor end
    from public.product p join public.unit u on u.code = p.content_unit
   where p.id = p_product_id
$$;

--
-- Name: unsync_public_fact(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.unsync_public_fact() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  delete from public.public_price_fact f
   using app.public_price_source s
   where s.fact_id = f.id and s.price_record_id = old.id;
  return old;
end $$;

--
-- Name: upsert_household_alias(uuid, uuid, uuid, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.upsert_household_alias(p_household uuid, p_store_id uuid, p_product_id uuid, p_text text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_id uuid;
begin
  if app.normalize_text(p_text) is null or p_store_id is null or p_product_id is null then
    return null;
  end if;
  insert into public.product_alias as a (household_id, store_id, product_id, alias_text)
  values (p_household, p_store_id, p_product_id, p_text)
  on conflict (store_id, normalized_text, household_id) where status = 'active'
  do update set product_id = excluded.product_id
  returning a.id into v_id;
  return v_id;
end $$;

--
-- Name: upsert_receipt_record(uuid, uuid, text, boolean); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.upsert_receipt_record(p_line_id uuid, p_product_id uuid, p_outcome text, p_is_bundle boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  d      record;
  v_line public.receipt_line;
  v_id   uuid;
begin
  select * into v_line from public.receipt_line where id = p_line_id;
  if v_line.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('receipt_line_id', p_line_id));
  end if;

  select * into d from app.derive_receipt_price(p_line_id, p_product_id);
  if not found then
    delete from public.price_record where receipt_line_id = p_line_id;
    return null;
  end if;

  insert into public.price_record as pr (
    household_id, product_id, store_id, branch_id, source_type, receipt_line_id, capture_id,
    transaction_date, currency, quantity, actual_weight, normal_price, promo_price,
    effective_price, price_basis, is_bundle, extra, match_tier, match_confidence, match_outcome,
    created_by)
  values (
    d.household_id, p_product_id, d.store_id, d.branch_id, 'receipt', p_line_id, d.capture_id,
    d.transaction_date, d.currency, d.quantity, d.actual_weight, d.normal_price, d.promo_price,
    d.effective_price, d.price_basis, coalesce(p_is_bundle, false),
    case when d.member_hint is null then '{}'::jsonb
         else jsonb_build_object('member_hint', d.member_hint) end,
    v_line.match_tier, v_line.match_confidence, p_outcome, (select auth.uid()))
  on conflict (receipt_line_id) do update
    set product_id    = excluded.product_id,
        is_bundle     = excluded.is_bundle,
        match_outcome = excluded.match_outcome,
        extra         = pr.extra || excluded.extra
  returning pr.id into v_id;
  return v_id;
end $$;

--
-- Name: valid_confidence_map(jsonb, text[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.valid_confidence_map(p_map jsonb, p_keys text[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$
  select case when jsonb_typeof(p_map) <> 'object' then false else not exists (
       select 1 from jsonb_each(p_map) e
        where not (e.key = any (p_keys))
           or case when jsonb_typeof(e.value) = 'number'
                   then (e.value #>> '{}')::numeric not between 0 and 1
                   else true end) end
$$;

--
-- Name: valid_price_extra(jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.valid_price_extra(p jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $_$
  select case when jsonb_typeof(p) <> 'object' then false else not exists (
       select 1 from jsonb_each(p) e
        where not coalesce(case e.key
          when 'shipping_fee'    then case when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric >= 0 else false end
          when 'shop_voucher'    then case when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric >= 0 else false end
          when 'cashback'        then case when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric >= 0 else false end
          when 'points'          then case when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric >= 0 else false end
          when 'listing_title'   then jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 500
          when 'listing_url'     then jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 2000
                                      and (e.value #>> '{}') like 'https://%'
          when 'member_note'     then jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 200
          when 'note'            then jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 500
          when 'member_eligible' then jsonb_typeof(e.value) = 'boolean'
          when 'member_hint'     then
                 jsonb_typeof(e.value) = 'object'
             and jsonb_typeof(e.value -> 'text') = 'string'
             and (e.value - 'text' - 'program_id') = '{}'::jsonb
             and (not (e.value ? 'program_id')
                  or (jsonb_typeof(e.value -> 'program_id') = 'string'
                      and (e.value ->> 'program_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
          else false
        end, false)) end
$_$;

--
-- Name: begin_account_deletion(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_account_deletion(p_user_id uuid) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$ select app.begin_account_deletion(p_user_id) $$;

--
-- Name: begin_ask(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_ask() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_household uuid := (app.my_household()).id;
  v_day       date;
  v_daily     integer := coalesce(app.config_int('ask_daily_limit'), 30);
  v_monthly   integer := coalesce(app.config_int('ask_monthly_limit'), 300);
  v_budget    numeric := coalesce(app.config_numeric('ai_daily_budget_usd'), 2.00);
  v_today_n   integer;
  v_month_n   integer;
begin
  if v_household is null then
    perform app.err('FORBIDDEN', jsonb_build_object('reason', 'no_household'));
  end if;
  v_day := app.household_today(v_household);

  insert into app.ask_usage (household_id, day) values (v_household, v_day)
  on conflict (household_id, day) do nothing;
  select questions into v_today_n
    from app.ask_usage where household_id = v_household and day = v_day
     for update;

  -- Setelah kunci: pernyataan baru melihat nilai terbaru baris yang dikunci.
  select coalesce(sum(questions), 0) into v_month_n
    from app.ask_usage
   where household_id = v_household
     and day >= date_trunc('month', v_day)::date and day <= v_day;

  if v_today_n >= v_daily then
    perform app.err('AI_QUOTA_EXCEEDED', jsonb_build_object('reason', 'daily', 'limit', v_daily));
  end if;
  if v_month_n >= v_monthly then
    perform app.err('AI_QUOTA_EXCEEDED', jsonb_build_object('reason', 'monthly', 'limit', v_monthly));
  end if;
  if app.ai_spend_today() >= v_budget then
    perform app.err('AI_QUOTA_EXCEEDED', jsonb_build_object('reason', 'budget'));
  end if;

  update app.ask_usage set questions = questions + 1, updated_at = now()
   where household_id = v_household and day = v_day;

  return jsonb_build_object(
    'day', v_day,
    'questions_today', v_today_n + 1, 'daily_limit', v_daily,
    'questions_month', v_month_n + 1, 'monthly_limit', v_monthly);
end $$;

--
-- Name: compare_sizes(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compare_sizes(p_group_id uuid, p_window text DEFAULT '90d'::text) RETURNS SETOF jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_cur char(3) := (app.my_household()).default_currency;
begin
  if p_window not in ('90d', 'all') then
    raise exception using errcode = '22023', message = 'INVALID_WINDOW', hint = 'Jendela 90d atau all.';
  end if;
  if not exists (select 1 from public.product_group where id = p_group_id) then
    perform app.err('NOT_FOUND', jsonb_build_object('product_group_id', p_group_id));
  end if;

  return query
  with base as (
    select p.id, p.pack_count, u.dimension,
           case when p_window = '90d' then s.best_90d_unit_price      else s.best_all_unit_price end      as unit_price,
           case when p_window = '90d' then s.best_90d_effective_price else s.best_all_effective_price end as effective_price,
           case when p_window = '90d' then s.best_90d_price_basis     else s.best_all_price_basis end     as price_basis,
           case when p_window = '90d' then s.best_90d_store_id        else s.best_all_store_id end        as store_id,
           case when p_window = '90d' then s.best_90d_branch_id       else s.best_all_branch_id end       as branch_id,
           case when p_window = '90d' then s.best_90d_date            else s.best_all_date end            as date,
           s.last_transaction_date,
           exists (select 1 from public.price_record r
                    where r.product_id = p.id and r.status = 'active' and r.currency <> v_cur) as other_currency
      from public.product p
      join public.unit u on u.code = p.content_unit
      left join public.price_summary s on s.product_id = p.id
     where p.product_group_id = p_group_id and p.status = 'active'),
  ranked as (
    select b.*,
           case when b.unit_price is not null
                then rank() over (partition by b.dimension, (b.unit_price is null) order by b.unit_price) end as rnk,
           min(b.unit_price) over (partition by b.dimension) as best
      from base b)
  select jsonb_build_object(
           'product', app.product_lite(r.id), 'dimension', r.dimension, 'currency', v_cur,
           'unit_price', r.unit_price, 'effective_price', r.effective_price, 'price_basis', r.price_basis,
           'per_pack_price', case when r.pack_count > 1 then round(r.effective_price / r.pack_count, 2) end,
           'store', app.store_json(r.store_id), 'branch', app.branch_json(r.branch_id), 'date', r.date,
           'last_transaction_date', r.last_transaction_date, 'rank', r.rnk,
           'pct_vs_best', case when r.unit_price is not null and r.best > 0
                               then round((r.unit_price - r.best) / r.best * 100, 1) end,
           'has_data', r.unit_price is not null,
           'other_currency', r.unit_price is null and r.other_currency)
    from ranked r
   order by r.dimension, (r.unit_price is null), r.unit_price, r.id;
end $$;

--
-- Name: confirm_capture_items(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_capture_items(p_capture_id uuid, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_c       public.capture;
  v_dec     jsonb;
  v_i       public.capture_item;
  v_saved   jsonb := '[]';
  v_rec     uuid;
  v_product uuid;
  v_pending integer;
begin
  -- 1. Kunci capture.
  select * into v_c from public.capture where id = p_capture_id for update;
  if v_c.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('capture_id', p_capture_id));
  end if;
  if v_c.kind = 'receipt' or v_c.status not in ('needs_confirmation', 'done') then
    perform app.err('INVALID_STATE', jsonb_build_object('capture_id', v_c.id, 'status', v_c.status));
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'items_must_be_array'));
  end if;

  perform app.mark_rpc();
  for v_dec in select * from jsonb_array_elements(p_items) loop
    -- 2. Kunci item; yang sudah diputuskan → hasil apa adanya (idempoten).
    select * into v_i from public.capture_item
     where id = (v_dec ->> 'item_id')::uuid and capture_id = v_c.id for update;
    if v_i.id is null then
      perform app.err('NOT_FOUND', jsonb_build_object('item_id', v_dec ->> 'item_id'));
    end if;
    if v_i.status = 'accepted' then
      v_saved := v_saved || jsonb_build_object('item_id', v_i.id, 'price_record_id', v_i.price_record_id);
      continue;
    elsif v_i.status = 'rejected' then
      continue;
    end if;

    case v_dec ->> 'action'
      when 'reject' then                                                 -- 3. "Bukan label harga"
        update public.capture_item set status = 'rejected', decided_by = (select auth.uid()), decided_at = now()
         where id = v_i.id;
      when 'accept' then                                                 -- 4–8
        v_product := coalesce((v_dec ->> 'product_id')::uuid, v_i.suggested_product_id);
        v_rec := app.accept_capture_item(
          v_i.id, v_product,
          case when v_i.match_tier = 'manual' or v_product is distinct from v_i.suggested_product_id
               then 'corrected' else 'confirmed' end,
          true);
        v_saved := v_saved || jsonb_build_object('item_id', v_i.id, 'price_record_id', v_rec);
      else
        perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'action', 'item_id', v_i.id));
    end case;
  end loop;

  -- 9. Tidak ada item pending → done. Simpan sebagian diizinkan.
  select count(*) into v_pending from public.capture_item where capture_id = v_c.id and status = 'pending';
  if v_pending = 0 and v_c.status = 'needs_confirmation' then
    update public.capture set status = 'done', processed_at = coalesce(processed_at, now()) where id = v_c.id;
  end if;
  return jsonb_build_object('saved', v_saved, 'remaining_pending', v_pending);
end $$;

--
-- Name: confirm_receipt(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_receipt(p_receipt_id uuid, p_lines jsonb, p_duplicate_decision text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_r          record;
  v_dup        uuid;
  v_dec        jsonb;
  v_line       public.receipt_line;
  v_product    uuid;
  v_outcome    text;
  v_rec_id     uuid;
  v_new_ids    uuid[] := '{}';
  v_undecided  uuid[];
  v_saved      integer;
  v_cheaper    integer;
begin
  -- 1. Kunci struk (RLS: hanya struk sendiri). Kolom eksplisit: pii tidak terbaca.
  select r.id, r.household_id, r.capture_id, r.store_id, r.transaction_date, r.total_amount, r.status,
         r.duplicate_of_receipt_id
    into v_r
    from public.receipt r where r.id = p_receipt_id for update;
  if v_r.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('receipt_id', p_receipt_id));
  end if;
  if p_duplicate_decision is not null and p_duplicate_decision not in ('distinct', 'discard') then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'duplicate_decision'));
  end if;

  -- 2. Idempoten.
  if v_r.status = 'confirmed'
     or (v_r.status = 'discarded' and p_duplicate_decision = 'discard') then
    return jsonb_build_object(
      'saved_count', (select count(*) from public.price_record pr
                        join public.receipt_line l on l.id = pr.receipt_line_id
                       where l.receipt_id = v_r.id and pr.status = 'active'),
      'cheaper_than_best_count', 0, 'receipt_status', v_r.status, 'replayed', true);
  end if;
  if v_r.status = 'discarded' then
    perform app.err('INVALID_STATE', jsonb_build_object('receipt_id', v_r.id, 'status', v_r.status));
  end if;

  -- 3. Kecurigaan duplikat dihitung ulang di bawah kunci advisory sidik jari.
  if v_r.store_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      format('receipt:%s:%s:%s:%s', v_r.household_id, v_r.store_id, v_r.transaction_date, v_r.total_amount), 0));
  end if;
  v_dup := app.receipt_duplicate(v_r.id);

  -- 4. Dicurigai duplikat tanpa keputusan (D-20, D-50).
  if v_dup is not null and p_duplicate_decision is null then
    perform app.err('DUPLICATE_DECISION_REQUIRED', jsonb_build_object('duplicate_of', v_dup));
  end if;

  perform app.mark_rpc();

  -- 5a. Buang.
  if p_duplicate_decision = 'discard' then
    perform app.set_receipt_state(v_r.id, 'discarded', v_dup);
    update public.price_record pr set status = 'void'
      from public.receipt_line l
     where l.id = pr.receipt_line_id and l.receipt_id = v_r.id and pr.status = 'active';
    update public.capture set status = 'done', processed_at = coalesce(processed_at, now())
     where id = v_r.capture_id and status = 'needs_confirmation';
    return jsonb_build_object('saved_count', 0, 'cheaper_than_best_count', 0, 'receipt_status', 'discarded');
  end if;

  -- 6. Toko wajib (D-49).
  if v_r.store_id is null then
    perform app.err('RECEIPT_STORE_REQUIRED', jsonb_build_object('receipt_id', v_r.id));
  end if;

  -- 7. Validasi keputusan: setiap baris produk tanpa record wajib diputuskan (Q-23).
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'lines_must_be_array'));
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) d
              where coalesce(d ->> 'action', '') not in ('accept', 'replace', 'non_product', 'skip')
                 or not exists (select 1 from public.receipt_line l
                                 where l.id = (d ->> 'line_id')::uuid and l.receipt_id = v_r.id
                                   and l.line_type = 'product')) then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'invalid_line_decision'));
  end if;
  select array_agg(l.id order by l.line_no) into v_undecided
    from public.receipt_line l
   where l.receipt_id = v_r.id and l.line_type = 'product'
     and not exists (select 1 from public.price_record pr where pr.receipt_line_id = l.id)
     and not exists (select 1 from jsonb_array_elements(p_lines) d where (d ->> 'line_id')::uuid = l.id);
  if v_undecided is not null then
    perform app.err('UNDECIDED_LINES', jsonb_build_object('line_ids', to_jsonb(v_undecided)));
  end if;

  -- 5b. 'distinct': penanda duplikat dilepas.
  perform app.set_receipt_state(v_r.id, 'draft', null);

  -- 8–10. Keputusan per baris.
  for v_dec in select * from jsonb_array_elements(p_lines) loop
    select * into v_line from public.receipt_line where id = (v_dec ->> 'line_id')::uuid for update;
    case v_dec ->> 'action'
      when 'non_product' then
        update public.receipt_line set line_type = 'non_product' where id = v_line.id;   -- trigger hapus record
        continue;
      when 'skip' then
        delete from public.price_record where receipt_line_id = v_line.id;
        continue;
      when 'accept' then
        v_product := v_line.suggested_product_id;
        v_outcome := 'confirmed';
      else
        v_product := (v_dec ->> 'product_id')::uuid;
        v_outcome := 'corrected';
    end case;

    v_product := app.resolve_product(v_product);
    if v_product is null or not exists (select 1 from public.product where id = v_product and status = 'active') then
      perform app.err('NOT_FOUND', jsonb_build_object('line_id', v_line.id, 'product_id', v_dec ->> 'product_id'));
    end if;

    if not exists (select 1 from public.price_record where receipt_line_id = v_line.id) then
      v_new_ids := v_new_ids || v_line.id;
    end if;
    v_rec_id := app.upsert_receipt_record(v_line.id, v_product, v_outcome,
                                          coalesce((v_dec ->> 'is_bundle')::boolean, false));
    perform app.upsert_household_alias(v_r.household_id, v_r.store_id, v_product, v_line.raw_text);
  end loop;

  -- 11. Lebih murah dari harga terbaik 90 hari (ringkasan sebelum antrean diproses).
  select count(*) into v_cheaper
    from public.price_record pr
    join public.price_summary s on s.household_id = pr.household_id and s.product_id = pr.product_id
   where pr.receipt_line_id = any (v_new_ids) and not pr.is_bundle
     and pr.unit_price < s.best_90d_unit_price;

  -- 12. Struk confirmed, capture done.
  perform app.set_receipt_state(v_r.id, 'confirmed', null);
  update public.capture set status = 'done', processed_at = coalesce(processed_at, now())
   where id = v_r.capture_id and status = 'needs_confirmation';

  select count(*) into v_saved
    from public.price_record pr join public.receipt_line l on l.id = pr.receipt_line_id
   where l.receipt_id = v_r.id and pr.status = 'active';
  return jsonb_build_object('saved_count', v_saved, 'cheaper_than_best_count', v_cheaper,
                            'receipt_status', 'confirmed');
end $$;

--
-- Name: correct_price_record(uuid, jsonb, timestamp with time zone, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.correct_price_record(p_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone, p_update_alias boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_r        public.price_record;
  v_new      public.price_record;
  v_numeric  constant text[] := array['normal_price', 'promo_price', 'promo_min_qty', 'promo_valid_from',
                                      'promo_valid_until', 'member_price', 'member_program_id',
                                      'transaction_date', 'store_id', 'branch_id'];
  v_price    record;
  v_eligible boolean;
  v_text     text;
begin
  perform app.check_patch_keys(p_patch, array['product_id', 'is_bundle', 'status', 'extra'] || v_numeric);

  select * into v_r from public.price_record where id = p_id for update;
  if v_r.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('price_record_id', p_id));
  end if;
  if v_r.updated_at is distinct from p_expected_updated_at then
    perform app.err('STALE_WRITE', jsonb_build_object('price_record_id', v_r.id, 'updated_at', v_r.updated_at));
  end if;
  if v_r.source_type = 'receipt' and exists (select 1 from jsonb_object_keys(p_patch) k where k = any (v_numeric)) then
    perform app.err('USE_RECEIPT_LINE', jsonb_build_object('receipt_line_id', v_r.receipt_line_id));
  end if;
  if p_patch ? 'status' and coalesce(p_patch ->> 'status', '') not in ('active', 'void') then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'status'));
  end if;
  if p_patch ? 'extra' and not app.valid_price_extra(coalesce(p_patch -> 'extra', 'null')) then
    perform app.err('INVALID_EXTRA', jsonb_build_object('extra', p_patch -> 'extra'));
  end if;

  v_new := v_r;
  if p_patch ? 'product_id' then
    v_new.product_id := app.resolve_product((p_patch ->> 'product_id')::uuid);
    if v_new.product_id is null then
      perform app.err('NOT_FOUND', jsonb_build_object('product_id', p_patch ->> 'product_id'));
    end if;
  end if;
  if p_patch ? 'is_bundle' then v_new.is_bundle := coalesce((p_patch ->> 'is_bundle')::boolean, false); end if;
  if p_patch ? 'status'    then v_new.status := p_patch ->> 'status'; end if;
  if p_patch ? 'extra' then
    -- member_eligible dan member_hint adalah kunci sistem: dipertahankan dari record.
    v_new.extra := ((p_patch -> 'extra') - 'member_eligible' - 'member_hint')
                   || jsonb_strip_nulls(jsonb_build_object('member_eligible', v_r.extra -> 'member_eligible',
                                                           'member_hint', v_r.extra -> 'member_hint'));
  end if;

  if v_r.source_type <> 'receipt' then
    if p_patch ? 'normal_price'      then v_new.normal_price      := (p_patch ->> 'normal_price')::numeric; end if;
    if p_patch ? 'promo_price'       then v_new.promo_price       := (p_patch ->> 'promo_price')::numeric; end if;
    if p_patch ? 'promo_min_qty'     then v_new.promo_min_qty     := (p_patch ->> 'promo_min_qty')::integer; end if;
    if p_patch ? 'promo_valid_from'  then v_new.promo_valid_from  := (p_patch ->> 'promo_valid_from')::date; end if;
    if p_patch ? 'promo_valid_until' then v_new.promo_valid_until := (p_patch ->> 'promo_valid_until')::date; end if;
    if p_patch ? 'member_price'      then v_new.member_price      := (p_patch ->> 'member_price')::numeric; end if;
    if p_patch ? 'member_program_id' then v_new.member_program_id := (p_patch ->> 'member_program_id')::uuid; end if;
    if p_patch ? 'transaction_date'  then v_new.transaction_date  := (p_patch ->> 'transaction_date')::date; end if;
    if p_patch ? 'store_id'          then v_new.store_id := (p_patch ->> 'store_id')::uuid; v_new.branch_id := null; end if;
    if p_patch ? 'branch_id'         then v_new.branch_id := (p_patch ->> 'branch_id')::uuid; end if;

    -- Input harga berubah → hitung ulang dengan SNAPSHOT keanggotaan (D-41, F-11).
    if (v_new.normal_price, v_new.promo_price, v_new.promo_valid_from, v_new.promo_valid_until,
        v_new.member_price, v_new.member_program_id, v_new.transaction_date)
       is distinct from
       (v_r.normal_price, v_r.promo_price, v_r.promo_valid_from, v_r.promo_valid_until,
        v_r.member_price, v_r.member_program_id, v_r.transaction_date) then
      v_eligible := coalesce((v_r.extra ->> 'member_eligible')::boolean, v_r.price_basis = 'member');
      select * into v_price
        from app.observation_price(v_r.household_id, v_new.transaction_date, v_new.normal_price, v_new.promo_price,
                                   v_new.promo_valid_from, v_new.promo_valid_until, v_new.member_price,
                                   v_new.member_program_id, v_eligible);
      if v_price.effective_price is null then
        perform app.err('NO_APPLICABLE_PRICE', jsonb_build_object('price_record_id', v_r.id));
      end if;
      v_new.effective_price := v_price.effective_price;
      v_new.price_basis     := v_price.price_basis;
      if v_new.member_price is not null then
        v_new.extra := v_new.extra || jsonb_build_object('member_eligible', v_eligible);
      end if;
    end if;
  end if;

  -- Idempoten: tidak ada perubahan → kembalikan apa adanya.
  if to_jsonb(v_new) = to_jsonb(v_r) then
    return (select to_jsonb(v) from public.price_record_view v where v.id = v_r.id);
  end if;

  -- Satu UPDATE = satu entri audit. Untuk record struk kolom angka tetap (penjaga D-23).
  update public.price_record set
    product_id = v_new.product_id, is_bundle = v_new.is_bundle, status = v_new.status, extra = v_new.extra,
    match_outcome = case when v_new.product_id <> v_r.product_id then 'corrected' else match_outcome end,
    normal_price = v_new.normal_price, promo_price = v_new.promo_price, promo_min_qty = v_new.promo_min_qty,
    promo_valid_from = v_new.promo_valid_from, promo_valid_until = v_new.promo_valid_until,
    member_price = v_new.member_price, member_program_id = v_new.member_program_id,
    transaction_date = v_new.transaction_date, store_id = v_new.store_id, branch_id = v_new.branch_id,
    effective_price = v_new.effective_price, price_basis = v_new.price_basis
   where id = v_r.id;

  -- Alias household dialihkan ke produk baru (D-35: menang atas alias global).
  if p_update_alias and v_new.product_id <> v_r.product_id then
    if v_r.source_type = 'receipt' then
      select l.raw_text into v_text from public.receipt_line l where l.id = v_r.receipt_line_id;
    else
      select case when v_r.source_type = 'marketplace' then coalesce(i.extra ->> 'listing_title', i.raw_text)
                  else i.raw_text end
        into v_text from public.capture_item i where i.price_record_id = v_r.id;
    end if;
    perform app.upsert_household_alias(v_r.household_id, v_new.store_id, v_new.product_id, v_text);
  end if;

  return (select to_jsonb(v) from public.price_record_view v where v.id = v_r.id);
end $$;

--
-- Name: correct_receipt_line(uuid, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.correct_receipt_line(p_line_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_line   public.receipt_line;
  v_status text;
  v_new    public.receipt_line;
  v_disc   jsonb := p_patch -> 'add_discount';
begin
  perform app.check_patch_keys(p_patch, array['quantity', 'unit_amount', 'line_amount', 'line_type',
                                              'applies_to_line_id', 'add_discount']);
  -- 1. Kunci induk lalu baris.
  select r.status into v_status
    from public.receipt r join public.receipt_line l on l.receipt_id = r.id
   where l.id = p_line_id
     for update of r;
  select * into v_line from public.receipt_line where id = p_line_id for update;
  if v_line.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('receipt_line_id', p_line_id));
  end if;
  if v_status = 'discarded' then
    perform app.err('INVALID_STATE', jsonb_build_object('receipt_line_id', v_line.id, 'receipt_status', v_status));
  end if;
  -- 2. Optimistik.
  if v_line.updated_at is distinct from p_expected_updated_at then
    perform app.err('STALE_WRITE', jsonb_build_object('receipt_line_id', v_line.id, 'updated_at', v_line.updated_at));
  end if;

  v_new := v_line;
  if p_patch ? 'quantity'           then v_new.quantity := (p_patch ->> 'quantity')::numeric; end if;
  if p_patch ? 'unit_amount'        then v_new.unit_amount := (p_patch ->> 'unit_amount')::numeric; end if;
  if p_patch ? 'line_amount'        then v_new.line_amount := (p_patch ->> 'line_amount')::numeric; end if;
  if p_patch ? 'line_type'          then v_new.line_type := p_patch ->> 'line_type'; end if;
  if p_patch ? 'applies_to_line_id' then v_new.applies_to_line_id := (p_patch ->> 'applies_to_line_id')::uuid; end if;

  -- 3. Update kolom yang diizinkan (patch sama → tidak menulis, idempoten).
  if to_jsonb(v_new) <> to_jsonb(v_line) then
    update public.receipt_line set
      quantity = v_new.quantity, unit_amount = v_new.unit_amount, line_amount = v_new.line_amount,
      line_type = v_new.line_type, applies_to_line_id = v_new.applies_to_line_id
     where id = v_line.id;
  end if;

  -- Diskon baru = baris discount dengan line_no berikutnya.
  if v_disc is not null and jsonb_typeof(v_disc) = 'object' then
    insert into public.receipt_line (receipt_id, household_id, line_no, line_type, raw_text, line_amount,
                                     applies_to_line_id, match_tier)
    select v_line.receipt_id, v_line.household_id, max(l.line_no) + 1, 'discount',
           coalesce(nullif(btrim(v_disc ->> 'raw_text'), ''), 'DISKON'),
           -abs((v_disc ->> 'line_amount')::numeric), v_line.id, 'manual'
      from public.receipt_line l where l.receipt_id = v_line.receipt_id;
  end if;

  -- 4. Trigger receipt_line_derive membentuk ulang record. 5. Kembalikan baris + record.
  return jsonb_build_object(
    'line', (select to_jsonb(l) from public.receipt_line l where l.id = v_line.id),
    'attached', coalesce((select jsonb_agg(to_jsonb(a) order by a.line_no) from public.receipt_line a
                           where a.applies_to_line_id = v_line.id), '[]'::jsonb),
    'record', (select to_jsonb(v) from public.price_record_view v where v.receipt_line_id = v_line.id));
end $$;

--
-- Name: create_private_branch(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_private_branch(p_branch jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_h  public.household;
  v_id uuid := coalesce((p_branch ->> 'id')::uuid, gen_random_uuid());
begin
  if exists (select 1 from public.branch where id = v_id) then
    return app.branch_json(v_id);                                           -- idempoten
  end if;
  v_h := app.require_household();
  if not exists (select 1 from public.store where id = (p_branch ->> 'store_id')::uuid) then
    perform app.err('NOT_FOUND', jsonb_build_object('store_id', p_branch ->> 'store_id'));
  end if;
  insert into public.branch (id, household_id, store_id, kind, name, address, city, region, external_ref)
  values (v_id, v_h.id, (p_branch ->> 'store_id')::uuid, coalesce(p_branch ->> 'kind', 'physical'),
          btrim(p_branch ->> 'name'), p_branch ->> 'address', p_branch ->> 'city', p_branch ->> 'region',
          p_branch ->> 'external_ref');
  return app.branch_json(v_id);
end $$;

--
-- Name: create_private_product(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_private_product(p_product jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_h     public.household;
  v_id    uuid := coalesce((p_product ->> 'id')::uuid, gen_random_uuid());
  v_brand uuid;
  v_group uuid;
  v_name  text := btrim(p_product ->> 'name');
  v_bc    jsonb;
begin
  if exists (select 1 from public.product where id = v_id) then
    return app.product_card(v_id);                                          -- idempoten (ID dari klien)
  end if;
  v_h := app.require_household();
  if v_name is null or v_name = '' then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'name_required'));
  end if;

  -- Brand: {id} | {new: nama}. Nama yang sudah ada (milik sendiri atau global) dipakai ulang.
  if p_product #>> '{brand,id}' is not null then
    v_brand := (p_product #>> '{brand,id}')::uuid;
  elsif app.normalize_text(p_product #>> '{brand,new}') is not null then
    select b.id into v_brand from public.brand b
     where b.status = 'active' and b.normalized_name = app.normalize_text(p_product #>> '{brand,new}')
     order by (b.household_id is null) limit 1;
    if v_brand is null then
      insert into public.brand (household_id, name) values (v_h.id, btrim(p_product #>> '{brand,new}'))
      returning id into v_brand;
    end if;
  end if;

  -- Group: {id} | {new: nama} | 'same_as_name'.
  if jsonb_typeof(p_product -> 'group') = 'object' and p_product #>> '{group,id}' is not null then
    v_group := (p_product #>> '{group,id}')::uuid;
  elsif jsonb_typeof(p_product -> 'group') = 'object' and app.normalize_text(p_product #>> '{group,new}') is not null then
    insert into public.product_group (household_id, brand_id, category_id, name)
    values (v_h.id, v_brand, (p_product ->> 'category_id')::uuid, btrim(p_product #>> '{group,new}'))
    returning id into v_group;
  elsif p_product ->> 'group' = 'same_as_name' then
    insert into public.product_group (household_id, brand_id, category_id, name)
    values (v_h.id, v_brand, (p_product ->> 'category_id')::uuid, v_name)
    returning id into v_group;
  end if;

  insert into public.product (id, household_id, product_group_id, brand_id, category_id, name, variant,
                              sale_mode, pack_count, content_size, content_unit)
  values (v_id, v_h.id, v_group, v_brand, (p_product ->> 'category_id')::uuid, v_name,
          nullif(btrim(p_product ->> 'variant'), ''),
          coalesce(p_product ->> 'sale_mode', 'unit'), coalesce((p_product ->> 'pack_count')::integer, 1),
          (p_product ->> 'content_size')::numeric, p_product ->> 'content_unit');

  for v_bc in select * from jsonb_array_elements(coalesce(p_product -> 'barcodes', '[]')) loop
    insert into public.barcode_assignment (product_id, code, code_type, store_id, valid_from)
    values (v_id, btrim(v_bc ->> 'code'), coalesce(v_bc ->> 'code_type', 'gtin'), (v_bc ->> 'store_id')::uuid,
            app.household_today(v_h.id));
  end loop;
  return app.product_card(v_id);
end $$;

--
-- Name: create_private_store(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_private_store(p_store jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_h  public.household;
  v_id uuid := coalesce((p_store ->> 'id')::uuid, gen_random_uuid());
begin
  if exists (select 1 from public.store where id = v_id) then
    return app.store_json(v_id);                                            -- idempoten
  end if;
  v_h := app.require_household();
  -- Nama yang sama di household ini → toko yang ada dipakai.
  insert into public.store (id, household_id, name, channel)
  values (v_id, v_h.id, btrim(p_store ->> 'name'), coalesce(p_store ->> 'channel', 'offline'))
  on conflict (household_id, normalized_name) do nothing;
  if not found then
    select id into v_id from public.store
     where household_id = v_h.id and normalized_name = app.normalize_text(p_store ->> 'name');
  end if;
  return app.store_json(v_id);
end $$;

--
-- Name: delete_capture(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_capture(p_capture_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_c     public.capture;
  v_paths text[];
  v_job   bigint;
begin
  select * into v_c from public.capture where id = p_capture_id for update;
  if v_c.id is null then
    return jsonb_build_object('capture_id', p_capture_id, 'deleted', false);   -- idempoten
  end if;
  if v_c.status not in ('uploaded', 'failed') then
    perform app.err('INVALID_STATE', jsonb_build_object('capture_id', v_c.id, 'status', v_c.status));
  end if;
  select array_agg(storage_path order by position) into v_paths
    from public.capture_image where capture_id = v_c.id;
  v_job := app.enqueue_storage_purge(v_c.household_id, coalesce(v_paths, '{}'));
  delete from public.capture where id = v_c.id;
  return jsonb_build_object('capture_id', v_c.id, 'deleted', true, 'purge_job_id', v_job);
end $$;

--
-- Name: end_shopping_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_shopping_session(p_session_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_s public.shopping_session;
begin
  select * into v_s from public.shopping_session where id = p_session_id for update;
  if v_s.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('shopping_session_id', p_session_id));
  end if;
  if v_s.ended_at is null then                                             -- sudah berakhir → sukses
    update public.shopping_session set ended_at = least(now(), expires_at) where id = v_s.id
    returning * into v_s;
  end if;
  return jsonb_build_object('id', v_s.id, 'started_at', v_s.started_at, 'expires_at', v_s.expires_at,
                            'ended_at', v_s.ended_at);
end $$;

--
-- Name: extend_shopping_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.extend_shopping_session(p_session_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_s public.shopping_session;
begin
  select * into v_s from public.shopping_session where id = p_session_id for update;
  if v_s.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('shopping_session_id', p_session_id));
  end if;
  if v_s.ended_at is not null or v_s.expires_at <= now() then
    perform app.err('SESSION_NOT_ACTIVE', jsonb_build_object('shopping_session_id', v_s.id));
  end if;
  update public.shopping_session
     set expires_at = expires_at + make_interval(hours => app.config_numeric('session_extend_hours')::integer)
   where id = v_s.id
   returning * into v_s;
  return jsonb_build_object('id', v_s.id, 'started_at', v_s.started_at, 'expires_at', v_s.expires_at);
end $$;

--
-- Name: find_product_by_barcode(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_product_by_barcode(p_code text, p_store_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object('product_id', coalesce(p.merged_into_id, p.id),
                            'via_merge', p.merged_into_id is not null)
    from public.barcode_assignment ba
    join public.product p on p.id = ba.product_id
   where ba.code = btrim(p_code)
     and ba.valid_from <= app.household_today((app.my_household()).id)
     and (ba.valid_until is null or ba.valid_until > app.household_today((app.my_household()).id))
     and (ba.code_type = 'gtin' or ba.store_id = p_store_id)
     and p.status <> 'archived'
   order by (ba.household_id is null), (ba.code_type = 'gtin'), ba.valid_from desc
   limit 1
$$;

--
-- Name: get_active_session(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_session() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
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

--
-- Name: get_capture(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_capture(p_capture_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_c public.capture;
begin
  select * into v_c from public.capture where id = p_capture_id;
  if v_c.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('capture_id', p_capture_id));
  end if;
  return jsonb_build_object(
    'capture', to_jsonb(v_c),
    'images', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'storage_path', i.storage_path,
                                                            'purged_at', i.purged_at, 'sha256', i.sha256)
                                         order by i.position)
                          from public.capture_image i where i.capture_id = v_c.id), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'started_at', r.started_at,
                                                          'finished_at', r.finished_at, 'error_message', r.error_message)
                                       order by r.started_at)
                        from public.processing_run r where r.capture_id = v_c.id), '[]'::jsonb),
    'receipt_id', (select r.id from public.receipt r where r.capture_id = v_c.id),
    'saved_records', coalesce((select jsonb_agg(to_jsonb(v) order by v.transaction_date desc, v.id)
                                 from public.price_record_view v where v.capture_id = v_c.id), '[]'::jsonb));
end $$;

--
-- Name: get_capture_items(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_capture_items(p_capture_id uuid) RETURNS SETOF jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
  if not exists (select 1 from public.capture where id = p_capture_id) then
    perform app.err('NOT_FOUND', jsonb_build_object('capture_id', p_capture_id));
  end if;

  return query
  select to_jsonb(i) || jsonb_build_object(
           'suggestion', app.product_lite(i.suggested_product_id),
           'candidates', coalesce((select jsonb_agg(app.product_lite(x.id) order by x.ord)
                                     from unnest(i.candidate_product_ids) with ordinality x(id, ord)
                                    where exists (select 1 from public.product p where p.id = x.id)), '[]'::jsonb),
           'computed', case
              when i.status = 'pending' then (
                select jsonb_build_object('effective_price', op.effective_price, 'price_basis', op.price_basis,
                                          'member_eligible', op.member_eligible, 'reason', op.reason,
                                          'unit_price', app.unit_price_for(i.suggested_product_id, op.effective_price))
                  from app.observation_price(i.household_id, i.transaction_date, i.normal_price, i.promo_price,
                                             i.promo_valid_from, i.promo_valid_until, i.member_price,
                                             i.member_program_id) op)
              when i.status = 'accepted' then (
                select jsonb_build_object('effective_price', pr.effective_price, 'price_basis', pr.price_basis,
                                          'member_eligible', (pr.extra -> 'member_eligible'), 'reason', null,
                                          'unit_price', pr.unit_price)
                  from public.price_record pr where pr.id = i.price_record_id) end,
           'needs_check', i.status = 'pending')
    from public.capture_item i
   where i.capture_id = p_capture_id
   order by i.position;
end $$;

--
-- Name: get_client_config(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_client_config() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb)
    from app.config c
   where c.key in ('best_price_window_days', 'trend_window_days', 'trend_min_records_per_window',
                   'trend_flat_threshold_pct', 'auto_save_min_confidence', 'near_best_threshold_pct',
                   'session_extend_hours', 'image_retention_months')
$$;

--
-- Name: get_my_context(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_context() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'display_name', (select pr.display_name from public.profile pr where pr.user_id = (select auth.uid())),
    'household', jsonb_build_object('id', h.id, 'name', h.name, 'default_currency', h.default_currency,
                                    'timezone', h.timezone, 'share_prices_public', h.share_prices_public),
    'role', (select m.role from public.household_member m
              where m.household_id = h.id and m.user_id = (select auth.uid())),
    'program_ids', coalesce((select jsonb_agg(m.member_program_id order by m.member_program_id)
                               from public.household_program_membership m where m.household_id = h.id),
                            '[]'::jsonb))
    from app.my_household() h
   where h.id is not null
$$;

--
-- Name: get_my_programs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_programs() RETURNS SETOF jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
           'program_id', mp.id, 'program_name', mp.name, 'status', mp.status,
           'store', app.store_json(mp.store_id),
           'is_member', exists (select 1 from public.household_program_membership m
                                 where m.member_program_id = mp.id
                                   and m.household_id = (app.my_household()).id))
    from public.member_program mp
    join public.store s on s.id = mp.store_id
   order by s.name, mp.name
$$;

--
-- Name: get_offline_cache(uuid[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_offline_cache(p_viewed_ids uuid[] DEFAULT '{}'::uuid[], p_top integer DEFAULT 50) RETURNS SETOF jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with viewed as (
    select app.resolve_product(x.id) as id, 0 as grp, x.ord::bigint as ord
      from unnest(coalesce(p_viewed_ids, '{}')) with ordinality x(id, ord)
     limit 200),
  top as (
    select s.product_id as id, 1 as grp, row_number() over (order by s.record_count desc, s.product_id) as ord
      from public.price_summary s
     order by s.record_count desc, s.product_id
     limit least(greatest(coalesce(p_top, 50), 0), 200)),
  allp as (
    select distinct on (id) id, grp, ord from (select * from viewed union all select * from top) u
     where id is not null
     order by id, grp, ord)
  select app.product_card(a.id) from allp a
    join public.product p on p.id = a.id and p.status <> 'merged'
   order by a.grp, a.ord
$$;

--
-- Name: get_product_cards(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_cards(p_ids uuid[]) RETURNS SETOF jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
  if cardinality(p_ids) > 50 then
    raise exception using errcode = '22023', message = 'TOO_MANY_IDS', hint = 'Maksimal 50 produk.';
  end if;
  return query
  select app.product_card(r.id)
    from (select app.resolve_product(x.id) as id, min(x.ord) as ord
            from unnest(p_ids) with ordinality x(id, ord)
           group by 1) r
   where r.id is not null
   order by r.ord;
end $$;

--
-- Name: get_product_detail(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_detail(p_product_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_p     public.product;
  v_id    uuid;
  v_trend jsonb;
begin
  select * into v_p from public.product where id = p_product_id;
  if v_p.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('product_id', p_product_id));
  end if;
  v_id := coalesce(v_p.merged_into_id, v_p.id);
  v_trend := public.price_trend(v_id, false);

  return jsonb_build_object(
    'redirect_to', case when v_id <> p_product_id then v_id end,
    'card', app.product_card(v_id),
    'last_record', (
      select jsonb_build_object('record_id', r.id, 'store', app.store_json(r.store_id),
                                'branch', app.branch_json(r.branch_id), 'date', r.transaction_date,
                                'effective_price', r.effective_price, 'price_basis', r.price_basis)
        from public.price_record r
       where r.product_id = v_id and r.status = 'active'
       order by r.transaction_date desc, r.created_at desc
       limit 1),
    'trend_windows', jsonb_build_object('cur_n', v_trend -> 'cur_n', 'prev_n', v_trend -> 'prev_n',
                                        'cur_avg', v_trend -> 'cur_avg', 'prev_avg', v_trend -> 'prev_avg'),
    'group_sizes_count', (select count(*) from public.product g
                           where g.product_group_id = (select product_group_id from public.product where id = v_id)
                             and g.status = 'active'));
end $$;

--
-- Name: get_receipt(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_receipt(p_receipt_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_r     record;
  v_dup   uuid;
  v_hint  jsonb;
  v_sum   numeric;
begin
  select r.id, r.household_id, r.capture_id, r.store_id, r.branch_id, r.transaction_date, r.transaction_time,
         r.currency, r.subtotal_amount, r.total_amount, r.payment_method, r.status, r.duplicate_of_receipt_id,
         r.confirmed_at, r.created_at, r.updated_at, r.field_confidence
    into v_r
    from public.receipt r where r.id = p_receipt_id;
  if v_r.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('receipt_id', p_receipt_id));
  end if;

  v_dup := case when v_r.status = 'draft' then app.receipt_duplicate(v_r.id) else v_r.duplicate_of_receipt_id end;
  select coalesce(sum(l.line_amount), 0) into v_sum from public.receipt_line l where l.receipt_id = v_r.id;
  select jsonb_strip_nulls(jsonb_build_object(
           'text', l.raw_text,
           'program_id', (select min(mp.id::text)::uuid from public.member_program mp
                           where mp.store_id = v_r.store_id and mp.status = 'active' having count(*) = 1)))
    into v_hint
    from public.receipt_line l
   where l.receipt_id = v_r.id and l.line_type = 'discount' and app.normalize_text(l.raw_text) ~ '\mmember\M'
   order by l.line_no limit 1;

  return jsonb_build_object(
    'header', jsonb_build_object(
      'id', v_r.id, 'status', v_r.status, 'capture_id', v_r.capture_id,
      'store', app.store_json(v_r.store_id), 'branch', app.branch_json(v_r.branch_id),
      'transaction_date', v_r.transaction_date, 'transaction_time', v_r.transaction_time,
      'currency', v_r.currency, 'subtotal_amount', v_r.subtotal_amount, 'total_amount', v_r.total_amount,
      'payment_method', v_r.payment_method, 'confirmed_at', v_r.confirmed_at, 'updated_at', v_r.updated_at),
    'field_confidence', v_r.field_confidence,
    'uploaded_at', (select c.uploaded_at from public.capture c where c.id = v_r.capture_id),
    'images', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'storage_path', i.storage_path,
                                                            'purged_at', i.purged_at) order by i.position)
                          from public.capture_image i where i.capture_id = v_r.capture_id), '[]'::jsonb),
    'totals', jsonb_build_object('lines_sum', v_sum, 'total_amount', v_r.total_amount,
                                 'diff', v_r.total_amount - v_sum),
    'duplicate', (select jsonb_build_object('receipt_id', d.id, 'store', app.store_json(d.store_id),
                                            'date', d.transaction_date, 'total', d.total_amount)
                    from public.receipt d where d.id = v_dup),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'line_no', l.line_no, 'line_type', l.line_type, 'raw_text', l.raw_text,
               'quantity', l.quantity, 'unit_amount', l.unit_amount, 'line_amount', l.line_amount,
               'updated_at', l.updated_at, 'match_tier', l.match_tier, 'match_confidence', l.match_confidence,
               'attached', coalesce((select jsonb_agg(jsonb_build_object(
                                        'id', a.id, 'line_no', a.line_no, 'line_type', a.line_type,
                                        'raw_text', a.raw_text, 'quantity', a.quantity,
                                        'line_amount', a.line_amount, 'updated_at', a.updated_at)
                                        order by a.line_no)
                                       from public.receipt_line a where a.applies_to_line_id = l.id), '[]'::jsonb),
               'suggestion', app.product_lite(l.suggested_product_id),
               'record', (select to_jsonb(v) from public.price_record_view v where v.receipt_line_id = l.id),
               'needs_check', l.line_type = 'product' and v_r.status = 'draft'
                              and not exists (select 1 from public.price_record pr where pr.receipt_line_id = l.id))
               order by l.line_no)
        from public.receipt_line l
       where l.receipt_id = v_r.id and l.line_type not in ('discount', 'void')), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'description', a.description,
                                                                 'amount', a.amount, 'points', a.points) order by a.created_at)
                               from public.receipt_adjustment a where a.receipt_id = v_r.id), '[]'::jsonb),
    'member_hint', v_hint,
    'membership_known', exists (select 1 from public.household_program_membership m
                                  join public.member_program mp on mp.id = m.member_program_id
                                 where m.household_id = v_r.household_id and mp.store_id = v_r.store_id));
end $$;

--
-- Name: list_captures(integer, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_captures(p_limit integer DEFAULT 30, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_kind text DEFAULT NULL::text) RETURNS SETOF jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'status', c.status,
           'store_name', (select s.name from public.store s where s.id = coalesce(r.store_id, c.store_id, ci.store_id)),
           'branch_name', (select b.name from public.branch b where b.id = coalesce(r.branch_id, c.branch_id, ci.branch_id)),
           'date', coalesce(r.transaction_date, ci.transaction_date,
                            (c.uploaded_at at time zone (select h.timezone from public.household h where h.id = c.household_id))::date),
           'date_is_upload', r.id is null,
           'needs_check_count', case
              when c.status <> 'needs_confirmation' then 0
              when r.id is not null then (select count(*) from public.receipt_line l
                                           where l.receipt_id = r.id and l.line_type = 'product'
                                             and not exists (select 1 from public.price_record pr where pr.receipt_line_id = l.id))
              else (select count(*) from public.capture_item i where i.capture_id = c.id and i.status = 'pending') end,
           'saved_count', (select count(*) from public.price_record pr where pr.capture_id = c.id and pr.status = 'active'),
           'error_message', c.error_message, 'error_code', c.error_code,
           'attempts', (select count(*) from public.processing_run pr where pr.capture_id = c.id),
           'uploaded_at', c.uploaded_at, 'receipt_id', r.id)
    from public.capture c
    left join public.receipt r on r.capture_id = c.id
    left join lateral (select i.store_id, i.branch_id, i.transaction_date from public.capture_item i
                        where i.capture_id = c.id order by i.position limit 1) ci on true
   where (p_before is null or c.uploaded_at < p_before)
     and (p_kind is null or c.kind = p_kind)
   order by c.uploaded_at desc, c.id desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

--
-- Name: merge_product(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_product(p_from uuid, p_into uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_from public.product;
  v_into public.product;
  v_uid  uuid := (select auth.uid());
begin
  select * into v_from from public.product where id = p_from for update;
  select * into v_into from public.product where id = p_into for update;

  if v_from.id is null or v_into.id is null then
    raise exception 'Produk tidak ditemukan';
  end if;
  if v_uid is not null and (v_from.household_id is null
       or v_from.household_id not in (select app.my_household_ids())) then
    raise exception 'Tidak berhak me-merge produk ini' using errcode = 'insufficient_privilege';
  end if;
  if v_into.household_id is not null and v_into.household_id is distinct from v_from.household_id then
    raise exception 'Target merge harus produk global atau milik household yang sama';
  end if;

  update public.product set status = 'merged', merged_into_id = p_into where id = p_from;
  update public.product set merged_into_id = p_into where merged_into_id = p_from;   -- padatkan rantai

  update public.product_alias set product_id = p_into where product_id = p_from;
  if v_from.household_id is not distinct from v_into.household_id then
    update public.barcode_assignment set product_id = p_into where product_id = p_from;
  end if;
  update public.price_record set product_id = p_into where product_id = p_from;
  delete from public.price_summary where product_id = p_from;

  if v_uid is not null then
    insert into public.audit_log (household_id, actor_id, entity_type, entity_id, action, before, after)
    values (v_from.household_id, v_uid, 'product', p_from, 'merge',
            to_jsonb(v_from), jsonb_build_object('merged_into_id', p_into));
  end if;
end $$;

--
-- Name: merge_product_preview(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_product_preview(p_from uuid, p_into uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_from   public.product;
  v_into   public.product;
  v_fd     text;
  v_id     text;
  v_reason text;
begin
  select * into v_from from public.product where id = p_from;
  select * into v_into from public.product where id = p_into;
  if v_from.id is null or v_into.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('from', p_from, 'into', p_into));
  end if;
  select dimension into v_fd from public.unit where code = v_from.content_unit;
  select dimension into v_id from public.unit where code = v_into.content_unit;

  v_reason := case
    when v_from.id = v_into.id then 'same_product'
    when v_from.status = 'merged' and v_from.merged_into_id = v_into.id then 'already_merged'
    when v_from.household_id is null then 'source_global'                       -- D-30, MERGE_FORBIDDEN
    when v_from.status <> 'active' then 'source_not_active'
    when v_into.status <> 'active' then 'target_not_active'
    when v_into.household_id is not null and v_into.household_id <> v_from.household_id then 'target_other_household'
  end;

  return jsonb_build_object(
    'can_merge', v_reason is null,
    'reason', v_reason,
    'counts', jsonb_build_object(
      'price_records', (select count(*) from public.price_record where product_id = v_from.id),
      'aliases',       (select count(*) from public.product_alias where product_id = v_from.id and status = 'active'),
      'barcodes',      (select count(*) from public.barcode_assignment where product_id = v_from.id),
      'barcodes_kept', case when v_from.household_id is distinct from v_into.household_id   -- F-01
                            then (select count(*) from public.barcode_assignment where product_id = v_from.id)
                            else 0 end),
    'size_mismatch', (v_from.sale_mode, v_from.pack_count, v_from.content_size, v_from.content_unit)
                     is distinct from (v_into.sale_mode, v_into.pack_count, v_into.content_size, v_into.content_unit),
    'dimension_mismatch', v_fd is distinct from v_id,
    'from', app.product_lite(v_from.id),
    'into', app.product_lite(v_into.id));
end $$;

--
-- Name: move_price_records(uuid[], uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_price_records(p_record_ids uuid[], p_target_product_id uuid, p_alias jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_h      public.household := app.require_household();
  v_found  integer;
  v_moved  integer;
  v_target uuid := app.resolve_product(p_target_product_id);
begin
  -- 1. Kunci record. Record household lain tidak terlihat oleh RLS → tidak ditemukan.
  select count(*) into v_found
    from (select id from public.price_record where id = any (p_record_ids) for update) x;
  if v_found <> (select count(distinct x) from unnest(p_record_ids) x) then
    perform app.err('RECORDS_NOT_OWNED', jsonb_build_object('requested', cardinality(p_record_ids), 'found', v_found));
  end if;
  -- 2. Target aktif dan terlihat.
  if v_target is null or not exists (select 1 from public.product where id = v_target and status = 'active') then
    perform app.err('NOT_FOUND', jsonb_build_object('product_id', p_target_product_id));
  end if;
  -- 3. Pindahkan (record struk diizinkan: koreksi produk dilakukan di Price Record, D-23).
  update public.price_record set product_id = v_target, match_outcome = 'corrected'
   where id = any (p_record_ids) and product_id <> v_target;
  get diagnostics v_moved = row_count;
  -- 4. Alias household.
  if p_alias is not null then
    perform app.upsert_household_alias(v_h.id, (p_alias ->> 'store_id')::uuid, v_target, p_alias ->> 'alias_text');
  end if;
  return jsonb_build_object('moved_count', v_moved, 'target_product_id', v_target);
end $$;

--
-- Name: price_chart(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.price_chart(p_product_id uuid, p_normal_only boolean DEFAULT false) RETURNS TABLE(date date, unit_price numeric, price_basis text, record_id uuid)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select v.transaction_date,
         case when p_normal_only then v.normal_unit_price else v.unit_price end,
         case when p_normal_only then 'normal' else v.price_basis end,
         v.id
    from public.price_record_view v
   where v.product_id = p_product_id and v.status = 'active' and not v.is_bundle
     and v.currency = (app.my_household()).default_currency
     and (not p_normal_only or v.normal_unit_price is not null)
   order by v.transaction_date, v.created_at
$$;

--
-- Name: branch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid,
    store_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    region text,
    external_ref text,
    status text DEFAULT 'open'::text NOT NULL,
    closed_at date,
    successor_branch_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT branch_check CHECK ((successor_branch_id IS DISTINCT FROM id)),
    CONSTRAINT branch_check1 CHECK (((successor_branch_id IS NULL) OR (status = 'closed'::text))),
    CONSTRAINT branch_kind_check CHECK ((kind = ANY (ARRAY['physical'::text, 'seller'::text]))),
    CONSTRAINT branch_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);

--
-- Name: member_program; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_program (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_program_status_check CHECK ((status = ANY (ARRAY['active'::text, 'discontinued'::text])))
);

--
-- Name: price_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_record (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    product_id uuid NOT NULL,
    store_id uuid NOT NULL,
    branch_id uuid,
    source_type text NOT NULL,
    receipt_line_id uuid,
    capture_id uuid,
    transaction_date date NOT NULL,
    currency character(3) DEFAULT 'IDR'::bpchar NOT NULL,
    quantity numeric(12,3) DEFAULT 1 NOT NULL,
    actual_weight numeric(12,3),
    normal_price numeric(14,2),
    promo_price numeric(14,2),
    promo_min_qty integer,
    promo_valid_from date,
    promo_valid_until date,
    member_price numeric(14,2),
    member_program_id uuid,
    effective_price numeric(14,2) NOT NULL,
    price_basis text NOT NULL,
    unit_price numeric(18,6) NOT NULL,
    is_bundle boolean DEFAULT false NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    extra jsonb DEFAULT '{}'::jsonb NOT NULL,
    match_tier text,
    match_confidence numeric(4,3),
    match_outcome text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT price_record_actual_weight_check CHECK ((actual_weight > (0)::numeric)),
    CONSTRAINT price_record_check CHECK (((source_type = 'receipt'::text) = (receipt_line_id IS NOT NULL))),
    CONSTRAINT price_record_check1 CHECK (((member_price IS NULL) OR (member_program_id IS NOT NULL))),
    CONSTRAINT price_record_check2 CHECK (((price_basis <> 'promo'::text) OR (promo_price IS NOT NULL))),
    CONSTRAINT price_record_check3 CHECK (((price_basis <> 'member'::text) OR (member_price IS NOT NULL))),
    CONSTRAINT price_record_check4 CHECK (((promo_valid_until IS NULL) OR (promo_valid_from IS NULL) OR (promo_valid_until >= promo_valid_from))),
    CONSTRAINT price_record_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT price_record_effective_price_check CHECK ((effective_price >= (0)::numeric)),
    CONSTRAINT price_record_extra_contract CHECK (app.valid_price_extra(extra)),
    CONSTRAINT price_record_match_confidence_check CHECK (((match_confidence >= (0)::numeric) AND (match_confidence <= (1)::numeric))),
    CONSTRAINT price_record_match_outcome_check CHECK ((match_outcome = ANY (ARRAY['auto'::text, 'confirmed'::text, 'corrected'::text]))),
    CONSTRAINT price_record_match_tier_check CHECK ((match_tier = ANY (ARRAY['barcode'::text, 'alias'::text, 'fuzzy'::text, 'ai'::text, 'manual'::text]))),
    CONSTRAINT price_record_member_price_check CHECK ((member_price >= (0)::numeric)),
    CONSTRAINT price_record_normal_price_check CHECK ((normal_price >= (0)::numeric)),
    CONSTRAINT price_record_price_basis_check CHECK ((price_basis = ANY (ARRAY['normal'::text, 'promo'::text, 'member'::text]))),
    CONSTRAINT price_record_promo_min_qty_check CHECK ((promo_min_qty >= 2)),
    CONSTRAINT price_record_promo_price_check CHECK ((promo_price >= (0)::numeric)),
    CONSTRAINT price_record_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT price_record_source_type_check CHECK ((source_type = ANY (ARRAY['receipt'::text, 'price_label'::text, 'marketplace'::text]))),
    CONSTRAINT price_record_status_check CHECK ((status = ANY (ARRAY['active'::text, 'void'::text]))),
    CONSTRAINT price_record_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'public'::text])))
);

--
-- Name: product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid,
    product_group_id uuid,
    brand_id uuid,
    category_id uuid,
    name text NOT NULL,
    variant text,
    sale_mode text DEFAULT 'unit'::text NOT NULL,
    pack_count integer DEFAULT 1 NOT NULL,
    content_size numeric(12,3),
    content_unit text NOT NULL,
    search_text text GENERATED ALWAYS AS (app.normalize_text(((name || ' '::text) || COALESCE(variant, ''::text)))) STORED,
    status text DEFAULT 'active'::text NOT NULL,
    merged_into_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_check CHECK (((sale_mode = 'unit'::text) = (content_size IS NOT NULL))),
    CONSTRAINT product_check1 CHECK (((sale_mode = 'unit'::text) OR (pack_count = 1))),
    CONSTRAINT product_check2 CHECK (((status = 'merged'::text) = (merged_into_id IS NOT NULL))),
    CONSTRAINT product_check3 CHECK ((merged_into_id IS DISTINCT FROM id)),
    CONSTRAINT product_content_size_check CHECK ((content_size > (0)::numeric)),
    CONSTRAINT product_pack_count_check CHECK ((pack_count >= 1)),
    CONSTRAINT product_sale_mode_check CHECK ((sale_mode = ANY (ARRAY['unit'::text, 'weight'::text]))),
    CONSTRAINT product_status_check CHECK ((status = ANY (ARRAY['active'::text, 'merged'::text, 'archived'::text])))
);

--
-- Name: receipt_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipt_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id uuid NOT NULL,
    household_id uuid NOT NULL,
    line_no smallint NOT NULL,
    line_type text NOT NULL,
    raw_text text NOT NULL,
    quantity numeric(12,3),
    unit_amount numeric(14,2),
    line_amount numeric(14,2) NOT NULL,
    applies_to_line_id uuid,
    suggested_product_id uuid,
    match_tier text,
    match_confidence numeric(4,3),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT receipt_line_check CHECK ((applies_to_line_id IS DISTINCT FROM id)),
    CONSTRAINT receipt_line_check1 CHECK (((line_type <> ALL (ARRAY['discount'::text, 'void'::text])) OR (applies_to_line_id IS NOT NULL))),
    CONSTRAINT receipt_line_line_no_check CHECK ((line_no >= 1)),
    CONSTRAINT receipt_line_line_type_check CHECK ((line_type = ANY (ARRAY['product'::text, 'discount'::text, 'void'::text, 'non_product'::text, 'tax'::text, 'other'::text]))),
    CONSTRAINT receipt_line_match_confidence_check CHECK (((match_confidence >= (0)::numeric) AND (match_confidence <= (1)::numeric))),
    CONSTRAINT receipt_line_match_tier_check CHECK ((match_tier = ANY (ARRAY['barcode'::text, 'alias'::text, 'fuzzy'::text, 'ai'::text, 'manual'::text]))),
    CONSTRAINT receipt_line_quantity_check CHECK ((quantity > (0)::numeric))
);

--
-- Name: store; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid,
    store_group_id uuid,
    name text NOT NULL,
    normalized_name text GENERATED ALWAYS AS (app.normalize_text(name)) STORED,
    channel text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT store_channel_check CHECK ((channel = ANY (ARRAY['offline'::text, 'online'::text]))),
    CONSTRAINT store_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

--
-- Name: unit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit (
    code text NOT NULL,
    name text NOT NULL,
    dimension text NOT NULL,
    to_base_factor numeric(18,6) NOT NULL,
    CONSTRAINT unit_dimension_check CHECK ((dimension = ANY (ARRAY['mass'::text, 'volume'::text, 'count'::text, 'length'::text]))),
    CONSTRAINT unit_to_base_factor_check CHECK ((to_base_factor > (0)::numeric))
);

--
-- Name: price_record_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.price_record_view WITH (security_invoker='true') AS
 SELECT pr.id,
    pr.household_id,
    pr.product_id,
    pr.store_id,
    pr.branch_id,
    pr.source_type,
    pr.receipt_line_id,
    pr.capture_id,
    pr.transaction_date,
    pr.currency,
    pr.quantity,
    pr.actual_weight,
    pr.normal_price,
    pr.promo_price,
    pr.promo_min_qty,
    pr.promo_valid_from,
    pr.promo_valid_until,
    pr.member_price,
    pr.member_program_id,
    pr.effective_price,
    pr.price_basis,
    pr.unit_price,
    pr.is_bundle,
    pr.visibility,
    pr.status,
    pr.extra,
    pr.match_tier,
    pr.match_confidence,
    pr.match_outcome,
    pr.created_by,
    pr.created_at,
    pr.updated_at,
    s.name AS store_name,
    s.channel AS store_channel,
    b.name AS branch_name,
    b.status AS branch_status,
    mp.name AS member_program_name,
        CASE
            WHEN (pr.normal_price IS NULL) THEN NULL::numeric
            WHEN (p.sale_mode = 'unit'::text) THEN (pr.normal_price / (((p.pack_count)::numeric * p.content_size) * u.to_base_factor))
            WHEN (p.sale_mode = 'weight'::text) THEN (pr.normal_price / u.to_base_factor)
            ELSE NULL::numeric
        END AS normal_unit_price,
    ((pr.member_price IS NOT NULL) AND (pr.price_basis <> 'member'::text)) AS member_not_counted,
    rl.receipt_id
   FROM ((((((public.price_record pr
     LEFT JOIN public.product p ON ((p.id = pr.product_id)))
     LEFT JOIN public.unit u ON ((u.code = p.content_unit)))
     LEFT JOIN public.store s ON ((s.id = pr.store_id)))
     LEFT JOIN public.branch b ON ((b.id = pr.branch_id)))
     LEFT JOIN public.member_program mp ON ((mp.id = pr.member_program_id)))
     LEFT JOIN public.receipt_line rl ON ((rl.id = pr.receipt_line_id)));

--
-- Name: price_history(uuid, boolean, uuid, integer, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.price_history(p_product_id uuid, p_include_void boolean DEFAULT false, p_store_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_before_date date DEFAULT NULL::date, p_before_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.price_record_view
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select v.* from public.price_record_view v
   where v.product_id = p_product_id
     and (p_include_void or v.status = 'active')
     and (p_store_id is null or v.store_id = p_store_id)
     and (p_before_date is null
          or (v.transaction_date, v.id) < (p_before_date, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by v.transaction_date desc, v.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

--
-- Name: price_record_detail(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.price_record_detail(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
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

--
-- Name: price_trend(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.price_trend(p_product_id uuid, p_normal_only boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_h     public.household := app.my_household();
  v_today date := app.household_today(v_h.id);
  v_w     integer := app.config_numeric('trend_window_days')::integer;
  v_min   integer := app.config_numeric('trend_min_records_per_window')::integer;
  v_flat  numeric := app.config_numeric('trend_flat_threshold_pct');
  v_cur_avg numeric; v_cur_n integer; v_prev_avg numeric; v_prev_n integer;
  v_count integer; v_last date;
  v_pct   numeric; v_dir text;
begin
  if not exists (select 1 from public.product where id = p_product_id) then
    perform app.err('NOT_FOUND', jsonb_build_object('product_id', p_product_id));
  end if;

  select avg(u) filter (where transaction_date >  v_today - v_w),
         count(*) filter (where transaction_date >  v_today - v_w),
         avg(u) filter (where transaction_date <= v_today - v_w and transaction_date > v_today - 2 * v_w),
         count(*) filter (where transaction_date <= v_today - v_w and transaction_date > v_today - 2 * v_w),
         count(*), max(transaction_date)
    into v_cur_avg, v_cur_n, v_prev_avg, v_prev_n, v_count, v_last
    from (select transaction_date,
                 case when p_normal_only then normal_unit_price else unit_price end as u
            from public.price_record_view
           where product_id = p_product_id and status = 'active' and not is_bundle
             and currency = v_h.default_currency) r
   where u is not null;

  if v_cur_n >= v_min and v_prev_n >= v_min and v_prev_avg > 0 then
    v_pct := round((v_cur_avg - v_prev_avg) / v_prev_avg * 100, 2);
    v_dir := case when v_pct >= v_flat then 'up' when v_pct <= -v_flat then 'down' else 'flat' end;
  end if;

  return jsonb_build_object(
    'cur_avg', round(v_cur_avg, 6), 'cur_n', v_cur_n, 'prev_avg', round(v_prev_avg, 6), 'prev_n', v_prev_n,
    'pct', v_pct, 'direction', v_dir, 'label', 'vs 30 hari sebelumnya',
    'min_records_per_window', v_min, 'normal_only', p_normal_only,
    'record_count', v_count, 'last_date', v_last);
end $$;

--
-- Name: recent_locations(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recent_locations(p_limit integer DEFAULT 10) RETURNS SETOF jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with used as (
    select store_id, branch_id, created_at as ts from public.price_record
    union all
    select store_id, branch_id, uploaded_at from public.capture where store_id is not null
    union all
    select b.store_id, s.branch_id, s.started_at from public.shopping_session s
      join public.branch b on b.id = s.branch_id),
  agg as (
    select store_id, branch_id, max(ts) as last_used from used group by store_id, branch_id)
  select jsonb_build_object('store', app.store_json(a.store_id), 'branch', app.branch_json(a.branch_id),
                            'last_used', a.last_used)
    from agg a
   order by a.last_used desc, a.store_id, a.branch_id
   limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

--
-- Name: record_ask_usage(date, integer, integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_ask_usage(p_day date, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric DEFAULT NULL::numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_household uuid := (app.my_household()).id;
  v_today     date;
begin
  if v_household is null then
    perform app.err('FORBIDDEN', jsonb_build_object('reason', 'no_household'));
  end if;
  v_today := app.household_today(v_household);
  if p_day is null or p_day not between v_today - 1 and v_today
     or p_input_tokens is null or p_input_tokens not between 0 and 2000000
     or p_output_tokens is null or p_output_tokens not between 0 and 200000
     or (p_cost_usd is not null and p_cost_usd not between 0 and 1) then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'ask_usage'));
  end if;

  update app.ask_usage
     set recorded      = recorded + 1,
         input_tokens  = input_tokens + p_input_tokens,
         output_tokens = output_tokens + p_output_tokens,
         cost_usd      = cost_usd + coalesce(p_cost_usd, 0),
         updated_at    = now()
   where household_id = v_household and day = p_day and recorded < questions;
  if not found then
    perform app.err('INVALID_STATE', jsonb_build_object('reason', 'no_open_question', 'day', p_day));
  end if;
end $$;

--
-- Name: retry_capture(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retry_capture(p_capture_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_c public.capture;
begin
  select * into v_c from public.capture where id = p_capture_id for update;
  if v_c.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('capture_id', p_capture_id));
  end if;
  if v_c.status = 'uploaded' then
    return jsonb_build_object('capture_id', v_c.id, 'status', v_c.status);    -- idempoten
  end if;
  if v_c.status <> 'failed' then
    perform app.err('INVALID_TRANSITION', jsonb_build_object('capture_id', v_c.id, 'from', v_c.status, 'to', 'uploaded'));
  end if;
  perform app.mark_rpc();
  update public.capture set status = 'uploaded', error_message = null, error_code = null
   where id = v_c.id;
  perform pg_notify('capture_uploaded', v_c.id::text);
  return jsonb_build_object('capture_id', v_c.id, 'status', 'uploaded');
end $$;

--
-- Name: search_products(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_products(p_query text, p_limit integer DEFAULT 30) RETURNS SETOF jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_q text := app.normalize_text(p_query);
begin
  if v_q is null or length(v_q) < 2 then
    raise exception using errcode = '22023', message = 'QUERY_TOO_SHORT',
                          hint = 'Ketik minimal 2 huruf.';
  end if;

  return query
  with brand_hit as (
    select b.id from public.brand b
     where b.status = 'active' and v_q operator(extensions.<%) b.normalized_name),
  hit as (
    select p.id,
           extensions.word_similarity(v_q, p.search_text || ' ' || coalesce(b.normalized_name, '')) as score
      from public.product p
      left join public.brand b on b.id = p.brand_id
     where p.status = 'active'                                   -- merged/archived disaring
       and (v_q operator(extensions.<%) p.search_text
            or p.brand_id in (select id from brand_hit))),
  card as (
    select app.product_card(h.id) as c, h.score from hit h)
  select card.c || jsonb_build_object('match_score', round(card.score::numeric, 3))
    from card
   order by (card.c -> 'summary') <> 'null'::jsonb desc,         -- yang punya data dulu (D-53)
            card.score desc, card.c #>> '{product,name}', card.c #>> '{product,id}'
   limit least(greatest(coalesce(p_limit, 30), 1), 50);
end $$;

--
-- Name: set_program_membership(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_program_membership(p_program_id uuid, p_member boolean) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_h  public.household := app.require_household();
  v_mp public.member_program;
begin
  select * into v_mp from public.member_program where id = p_program_id;
  if v_mp.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('program_id', p_program_id));
  end if;
  if p_member then
    if v_mp.status = 'discontinued'
       and not exists (select 1 from public.household_program_membership
                        where household_id = v_h.id and member_program_id = v_mp.id) then
      perform app.err('INVALID_STATE', jsonb_build_object('program_id', v_mp.id, 'status', v_mp.status));
    end if;
    insert into public.household_program_membership (household_id, member_program_id)
    values (v_h.id, v_mp.id) on conflict do nothing;
  else
    delete from public.household_program_membership where household_id = v_h.id and member_program_id = v_mp.id;
  end if;
  -- D-41: record lama tidak dihitung ulang.
  return jsonb_build_object('program_id', v_mp.id, 'is_member', p_member);
end $$;

--
-- Name: set_share_prices_public(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_share_prices_public(p_enabled boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_hh uuid := app.require_owner();
  v_n  integer := 0;
begin
  perform 1 from public.household where id = v_hh for update;
  update public.household set share_prices_public = p_enabled where id = v_hh;
  if not p_enabled then
    -- Penarikan sinkron (janji privasi): trigger menghapus fakta per record.
    update public.price_record set visibility = 'private'
     where household_id = v_hh and visibility = 'public';
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('enabled', p_enabled, 'withdrawn_count', v_n);
end $$;

--
-- Name: share_existing_prices(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.share_existing_prices() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_hh  uuid := app.require_owner();
  v_job bigint;
begin
  if not (select share_prices_public from public.household where id = v_hh) then
    perform app.err('INVALID_STATE', jsonb_build_object('reason', 'share_disabled'));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('share_existing:' || v_hh, 0));
  select id into v_job from app.job
   where kind = 'share_existing_prices' and status in ('pending', 'running')
     and payload ->> 'household_id' = v_hh::text
   limit 1;
  if v_job is null then
    insert into app.job (kind, payload) values ('share_existing_prices', jsonb_build_object('household_id', v_hh))
    returning id into v_job;
  end if;
  return jsonb_build_object(
    'job_id', v_job,
    'eligible_count', (select count(*) from public.price_record
                        where household_id = v_hh and visibility = 'private' and status = 'active'));
end $$;

--
-- Name: start_shopping_session(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_shopping_session(p_session_id uuid, p_branch_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_h      public.household;
  v_branch public.branch;
begin
  if exists (select 1 from public.shopping_session where id = p_session_id) then
    return public.get_active_session();                                    -- idempoten
  end if;
  v_h := app.require_household();
  select * into v_branch from public.branch where id = p_branch_id;
  if v_branch.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('branch_id', p_branch_id));
  end if;
  if v_branch.status <> 'open' then
    perform app.err('BRANCH_CLOSED', jsonb_build_object('branch_id', v_branch.id,
                                                        'successor_branch_id', v_branch.successor_branch_id));
  end if;

  -- Satu sesi aktif per household (D-72): sesi lain diakhiri lebih dulu.
  perform pg_advisory_xact_lock(hashtextextended('shopping_session:' || v_h.id, 0));
  update public.shopping_session set ended_at = least(now(), expires_at)
   where household_id = v_h.id and ended_at is null;
  insert into public.shopping_session (id, household_id, branch_id, started_by)
  values (p_session_id, v_h.id, v_branch.id, (select auth.uid()));
  return public.get_active_session();
end $$;

--
-- Name: submit_capture(uuid, text, jsonb, uuid, uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_capture(p_capture_id uuid, p_kind text, p_images jsonb, p_shopping_session_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_h       public.household;
  v_c       public.capture;
  v_paths   text[];
  v_missing text[];
  v_store   uuid := p_store_id;
  v_branch  uuid := p_branch_id;
  v_img     jsonb;
begin
  -- 1. Idempoten (D-59): capture yang sudah ada dikembalikan apa adanya.
  select * into v_c from public.capture where id = p_capture_id;
  if v_c.id is not null then
    return jsonb_build_object('capture_id', v_c.id, 'status', v_c.status, 'created', false);
  end if;

  v_h := app.require_household();
  if p_kind not in ('receipt', 'price_label', 'marketplace') then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'kind'));
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) = 0 then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'images_required'));
  end if;
  for v_img in select * from jsonb_array_elements(p_images) loop
    if jsonb_typeof(v_img -> 'position') <> 'number' or (v_img ->> 'position')::int < 1
       or coalesce(v_img ->> 'ext', '') not in ('jpg', 'jpeg', 'png', 'webp', 'heic')
       or coalesce(v_img ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then
      perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'image', 'image', v_img));
    end if;
  end loop;

  -- 2–3. Path dibangun server; semua file harus sudah ada di Storage.
  select array_agg(format('%s/%s/%s.%s', v_h.id, p_capture_id, e ->> 'position', e ->> 'ext') order by (e ->> 'position')::int)
    into v_paths from jsonb_array_elements(p_images) e;
  v_missing := app.missing_storage_paths(v_h.id, v_paths);
  if cardinality(v_missing) > 0 then
    perform app.err('CAPTURE_IMAGES_MISSING', jsonb_build_object('missing', to_jsonb(v_missing)));
  end if;

  -- 4. Sesi (boleh sudah kedaluwarsa, D-59): lokasi diisi dari cabang sesi jika kosong.
  if p_shopping_session_id is not null then
    select b.store_id, b.id into v_store, v_branch
      from public.shopping_session s join public.branch b on b.id = s.branch_id
     where s.id = p_shopping_session_id;
    if not found then
      perform app.err('NOT_FOUND', jsonb_build_object('shopping_session_id', p_shopping_session_id));
    end if;
    if p_store_id is not null then
      v_store := p_store_id; v_branch := p_branch_id;
    end if;
  end if;

  -- 5. Insert capture + gambar.
  insert into public.capture (id, household_id, kind, status, shopping_session_id, store_id, branch_id,
                              uploaded_by, captured_at)
  values (p_capture_id, v_h.id, p_kind, 'uploaded', p_shopping_session_id, v_store, v_branch,
          (select auth.uid()), p_captured_at)
  returning * into v_c;

  insert into public.capture_image (capture_id, household_id, position, storage_path, sha256, byte_size)
  select p_capture_id, v_h.id, (e ->> 'position')::smallint,
         format('%s/%s/%s.%s', v_h.id, p_capture_id, e ->> 'position', e ->> 'ext'),
         e ->> 'sha256', (e ->> 'byte_size')::integer
    from jsonb_array_elements(p_images) e;

  -- 6. Bangunkan worker.
  perform pg_notify('capture_uploaded', p_capture_id::text);
  return jsonb_build_object('capture_id', v_c.id, 'status', v_c.status, 'created', true);
end $_$;

--
-- Name: update_capture_item(uuid, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_capture_item(p_item_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: where_cheaper(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.where_cheaper(p_product_id uuid DEFAULT NULL::uuid, p_group_id uuid DEFAULT NULL::uuid, p_window_days integer DEFAULT 90) RETURNS SETOF jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_today date := app.household_today((app.my_household()).id);
begin
  if (p_product_id is null) = (p_group_id is null) then
    raise exception using errcode = '22023', message = 'ONE_OF_PRODUCT_OR_GROUP',
                          hint = 'Isi salah satu: produk atau group.';
  end if;
  if p_product_id is not null and not exists (select 1 from public.product where id = p_product_id)
     or p_group_id is not null and not exists (select 1 from public.product_group where id = p_group_id) then
    perform app.err('NOT_FOUND', jsonb_build_object('product_id', p_product_id, 'product_group_id', p_group_id));
  end if;

  return query
  with agg as (
    select u.dimension, pr.currency, pr.store_id, pr.branch_id,
           min(pr.unit_price) as min_unit_price, avg(pr.unit_price) as avg_unit_price,
           count(*) as n, max(pr.transaction_date) as last_date
      from public.price_record pr
      join public.product p on p.id = pr.product_id
      join public.unit u    on u.code = p.content_unit
     where (p_product_id is null or pr.product_id = p_product_id)
       and (p_group_id   is null or p.product_group_id = p_group_id)
       and pr.status = 'active' and not pr.is_bundle
       and (p_window_days is null or pr.transaction_date > v_today - p_window_days)
     group by u.dimension, pr.currency, pr.store_id, pr.branch_id)
  select jsonb_build_object(
           'dimension', a.dimension, 'currency', a.currency,
           'store', app.store_json(a.store_id), 'branch', app.branch_json(a.branch_id),
           'successor_branch', case when b.status = 'closed' then app.branch_json(b.successor_branch_id) end,
           'min_unit_price', a.min_unit_price, 'avg_unit_price', round(a.avg_unit_price, 6),
           'n', a.n, 'last_date', a.last_date, 'is_online', s.channel = 'online')
    from agg a
    join public.store s on s.id = a.store_id
    left join public.branch b on b.id = a.branch_id
   order by a.dimension, a.currency, a.avg_unit_price, a.store_id, a.branch_id;
end $$;

--
-- Name: ask_usage; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.ask_usage (
    household_id uuid NOT NULL,
    day date NOT NULL,
    questions integer DEFAULT 0 NOT NULL,
    recorded integer DEFAULT 0 NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ask_usage_check CHECK (((recorded >= 0) AND (recorded <= questions))),
    CONSTRAINT ask_usage_cost_usd_check CHECK ((cost_usd >= (0)::numeric)),
    CONSTRAINT ask_usage_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT ask_usage_output_tokens_check CHECK ((output_tokens >= 0)),
    CONSTRAINT ask_usage_questions_check CHECK ((questions >= 0))
);

--
-- Name: config; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.config (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text
);

--
-- Name: job_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.job ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME app.job_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: match_quality_daily; Type: VIEW; Schema: app; Owner: -
--

CREATE VIEW app.match_quality_daily AS
 SELECT (created_at)::date AS day,
    source_type,
    match_tier,
    count(*) AS total,
    count(*) FILTER (WHERE (match_outcome = 'auto'::text)) AS auto_matched,
    count(*) FILTER (WHERE (match_outcome = 'confirmed'::text)) AS confirmed,
    count(*) FILTER (WHERE (match_outcome = 'corrected'::text)) AS corrected
   FROM public.price_record
  GROUP BY ((created_at)::date), source_type, match_tier;

--
-- Name: public_price_source; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.public_price_source (
    fact_id uuid NOT NULL,
    price_record_id uuid NOT NULL
);

--
-- Name: summary_refresh_queue; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.summary_refresh_queue (
    household_id uuid NOT NULL,
    product_id uuid NOT NULL,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    household_id uuid NOT NULL,
    actor_id uuid,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    action text NOT NULL,
    before jsonb,
    after jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_action_check CHECK ((action = ANY (ARRAY['update'::text, 'delete'::text, 'merge'::text])))
);

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: barcode_assignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.barcode_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    household_id uuid,
    code text NOT NULL,
    code_type text NOT NULL,
    store_id uuid,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_until date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT barcode_assignment_check CHECK (((valid_until IS NULL) OR (valid_until > valid_from))),
    CONSTRAINT barcode_assignment_check1 CHECK (((code_type = 'plu'::text) = (store_id IS NOT NULL))),
    CONSTRAINT barcode_assignment_check2 CHECK (((code_type <> 'gtin'::text) OR (code ~ '^[0-9]{8,14}$'::text))),
    CONSTRAINT barcode_assignment_code_type_check CHECK ((code_type = ANY (ARRAY['gtin'::text, 'plu'::text])))
);

--
-- Name: brand; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid,
    name text NOT NULL,
    normalized_name text GENERATED ALWAYS AS (app.normalize_text(name)) STORED,
    status text DEFAULT 'active'::text NOT NULL,
    merged_into_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brand_check CHECK (((status = 'merged'::text) = (merged_into_id IS NOT NULL))),
    CONSTRAINT brand_check1 CHECK ((merged_into_id IS DISTINCT FROM id)),
    CONSTRAINT brand_status_check CHECK ((status = ANY (ARRAY['active'::text, 'merged'::text])))
);

--
-- Name: capture; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capture (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    shopping_session_id uuid,
    store_id uuid,
    branch_id uuid,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    error_message text,
    error_code text,
    captured_at timestamp with time zone,
    CONSTRAINT capture_branch_needs_store CHECK (((store_id IS NOT NULL) OR (branch_id IS NULL))),
    CONSTRAINT capture_error_code_check CHECK ((error_code = ANY (ARRAY['blurry'::text, 'not_a_receipt'::text, 'unsupported'::text, 'timeout'::text, 'other'::text]))),
    CONSTRAINT capture_kind_check CHECK ((kind = ANY (ARRAY['receipt'::text, 'price_label'::text, 'marketplace'::text]))),
    CONSTRAINT capture_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'processing'::text, 'needs_confirmation'::text, 'done'::text, 'failed'::text])))
);

--
-- Name: capture_image; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capture_image (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    capture_id uuid NOT NULL,
    household_id uuid NOT NULL,
    "position" smallint NOT NULL,
    storage_path text NOT NULL,
    sha256 text NOT NULL,
    byte_size integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purge_after timestamp with time zone DEFAULT (now() + '1 year'::interval) NOT NULL,
    purged_at timestamp with time zone,
    CONSTRAINT capture_image_byte_size_check CHECK ((byte_size > 0)),
    CONSTRAINT capture_image_position_check CHECK (("position" >= 1)),
    CONSTRAINT capture_image_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);

--
-- Name: capture_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capture_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    capture_id uuid NOT NULL,
    household_id uuid NOT NULL,
    "position" smallint NOT NULL,
    image_position smallint,
    region jsonb,
    raw_text text NOT NULL,
    suggested_product_id uuid,
    candidate_product_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    match_tier text,
    match_confidence numeric(4,3),
    store_id uuid,
    branch_id uuid,
    seller_name text,
    seller_ref text,
    transaction_date date NOT NULL,
    currency character(3) DEFAULT 'IDR'::bpchar NOT NULL,
    normal_price numeric(14,2),
    promo_price numeric(14,2),
    promo_min_qty integer,
    promo_valid_from date,
    promo_valid_until date,
    member_price numeric(14,2),
    member_program_id uuid,
    is_bundle boolean DEFAULT false NOT NULL,
    extra jsonb DEFAULT '{}'::jsonb NOT NULL,
    field_confidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    price_record_id uuid,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    read_member_price numeric(14,2),
    read_member_program_name text,
    CONSTRAINT capture_item_candidate_product_ids_check CHECK ((cardinality(candidate_product_ids) <= 5)),
    CONSTRAINT capture_item_check CHECK (((store_id IS NOT NULL) OR (branch_id IS NULL))),
    CONSTRAINT capture_item_check1 CHECK (((member_price IS NULL) OR (member_program_id IS NOT NULL))),
    CONSTRAINT capture_item_check2 CHECK (((status = 'pending'::text) = (decided_at IS NULL))),
    CONSTRAINT capture_item_check3 CHECK (((promo_valid_until IS NULL) OR (promo_valid_from IS NULL) OR (promo_valid_until >= promo_valid_from))),
    CONSTRAINT capture_item_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT capture_item_extra_contract CHECK (app.valid_price_extra(extra)),
    CONSTRAINT capture_item_field_confidence_shape CHECK (app.valid_confidence_map(field_confidence, ARRAY['product'::text, 'price'::text, 'date'::text, 'store'::text])),
    CONSTRAINT capture_item_image_position_check CHECK ((image_position >= 1)),
    CONSTRAINT capture_item_match_confidence_check CHECK (((match_confidence >= (0)::numeric) AND (match_confidence <= (1)::numeric))),
    CONSTRAINT capture_item_match_tier_check CHECK ((match_tier = ANY (ARRAY['barcode'::text, 'alias'::text, 'fuzzy'::text, 'ai'::text, 'manual'::text]))),
    CONSTRAINT capture_item_member_price_check CHECK ((member_price >= (0)::numeric)),
    CONSTRAINT capture_item_normal_price_check CHECK ((normal_price >= (0)::numeric)),
    CONSTRAINT capture_item_position_check CHECK (("position" >= 1)),
    CONSTRAINT capture_item_promo_min_qty_check CHECK ((promo_min_qty >= 2)),
    CONSTRAINT capture_item_promo_price_check CHECK ((promo_price >= (0)::numeric)),
    CONSTRAINT capture_item_read_member_price_check CHECK ((read_member_price >= (0)::numeric)),
    CONSTRAINT capture_item_read_member_program_name_check CHECK ((char_length(read_member_program_name) <= 200)),
    CONSTRAINT capture_item_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])))
);

--
-- Name: COLUMN capture_item.read_member_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.capture_item.read_member_price IS 'Harga member seperti terbaca extractor (Q-77). Tidak diubah user; dipakai W18 untuk pemetaan ulang program saat lokasi berubah.';

--
-- Name: COLUMN capture_item.read_member_program_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.capture_item.read_member_program_name IS 'Nama program member seperti terbaca extractor (Q-77).';

--
-- Name: category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid,
    parent_id uuid,
    slug text,
    name text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT category_check CHECK ((parent_id IS DISTINCT FROM id))
);

--
-- Name: household_member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.household_member (
    household_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT household_member_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])))
);

--
-- Name: household_program_membership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.household_program_membership (
    household_id uuid NOT NULL,
    member_program_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: price_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_summary (
    household_id uuid NOT NULL,
    product_id uuid NOT NULL,
    record_count integer NOT NULL,
    last_transaction_date date NOT NULL,
    last_effective_price numeric(14,2) NOT NULL,
    last_unit_price numeric(18,6) NOT NULL,
    best_90d_record_id uuid,
    best_90d_unit_price numeric(18,6),
    best_90d_effective_price numeric(14,2),
    best_90d_price_basis text,
    best_90d_date date,
    best_90d_store_id uuid,
    best_90d_branch_id uuid,
    best_all_record_id uuid NOT NULL,
    best_all_unit_price numeric(18,6) NOT NULL,
    best_all_effective_price numeric(14,2) NOT NULL,
    best_all_price_basis text NOT NULL,
    best_all_date date NOT NULL,
    best_all_store_id uuid NOT NULL,
    best_all_branch_id uuid,
    trend_direction text,
    trend_pct numeric(8,2),
    as_of_date date NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT price_summary_trend_direction_check CHECK ((trend_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text])))
);

--
-- Name: processing_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processing_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    capture_id uuid NOT NULL,
    household_id uuid NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    ocr_engine text,
    ai_model text,
    prompt_version text,
    raw_ocr_text text,
    raw_ai_output jsonb,
    input_tokens integer,
    output_tokens integer,
    cost_usd numeric(12,6),
    error_message text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    pii_redacted_at timestamp with time zone,
    CONSTRAINT processing_run_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])))
);

--
-- Name: product_alias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_alias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid,
    store_id uuid NOT NULL,
    product_id uuid NOT NULL,
    alias_text text NOT NULL,
    normalized_text text GENERATED ALWAYS AS (app.normalize_text(alias_text)) STORED,
    status text DEFAULT 'active'::text NOT NULL,
    promoted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_alias_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
);

--
-- Name: product_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_group (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid,
    brand_id uuid,
    category_id uuid,
    name text NOT NULL,
    normalized_name text GENERATED ALWAYS AS (app.normalize_text(name)) STORED,
    status text DEFAULT 'active'::text NOT NULL,
    merged_into_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_group_check CHECK (((status = 'merged'::text) = (merged_into_id IS NOT NULL))),
    CONSTRAINT product_group_check1 CHECK ((merged_into_id IS DISTINCT FROM id)),
    CONSTRAINT product_group_status_check CHECK ((status = ANY (ARRAY['active'::text, 'merged'::text])))
);

--
-- Name: profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile (
    user_id uuid NOT NULL,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: public_price_fact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_price_fact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    store_id uuid NOT NULL,
    branch_id uuid,
    transaction_date date NOT NULL,
    currency character(3) NOT NULL,
    effective_price numeric(14,2) NOT NULL,
    unit_price numeric(18,6) NOT NULL,
    price_basis text NOT NULL,
    source_type text NOT NULL
);

--
-- Name: receipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    capture_id uuid,
    store_id uuid,
    branch_id uuid,
    transaction_date date NOT NULL,
    transaction_time time without time zone,
    currency character(3) DEFAULT 'IDR'::bpchar NOT NULL,
    subtotal_amount numeric(14,2),
    total_amount numeric(14,2) NOT NULL,
    payment_method text,
    pii jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    duplicate_of_receipt_id uuid,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    field_confidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT receipt_branch_needs_store CHECK (((store_id IS NOT NULL) OR (branch_id IS NULL))),
    CONSTRAINT receipt_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT receipt_field_confidence_shape CHECK (app.valid_confidence_map(field_confidence, ARRAY['store'::text, 'branch'::text, 'date'::text, 'time'::text, 'total'::text, 'subtotal'::text])),
    CONSTRAINT receipt_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'discarded'::text]))),
    CONSTRAINT receipt_store_required CHECK (((status = 'draft'::text) OR (store_id IS NOT NULL)))
);

--
-- Name: receipt_adjustment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipt_adjustment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id uuid NOT NULL,
    household_id uuid NOT NULL,
    kind text NOT NULL,
    description text,
    amount numeric(14,2),
    points numeric(14,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT receipt_adjustment_check CHECK (((amount IS NOT NULL) OR (points IS NOT NULL))),
    CONSTRAINT receipt_adjustment_kind_check CHECK ((kind = ANY (ARRAY['voucher'::text, 'cashback'::text, 'points'::text, 'shipping'::text, 'other'::text])))
);

--
-- Name: shopping_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopping_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    started_by uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '04:00:00'::interval) NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT shopping_session_check CHECK ((expires_at > started_at)),
    CONSTRAINT shopping_session_check1 CHECK (((ended_at IS NULL) OR (ended_at >= started_at)))
);

--
-- Name: store_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_group (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: ask_usage ask_usage_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.ask_usage
    ADD CONSTRAINT ask_usage_pkey PRIMARY KEY (household_id, day);

--
-- Name: config config_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.config
    ADD CONSTRAINT config_pkey PRIMARY KEY (key);

--
-- Name: job job_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.job
    ADD CONSTRAINT job_pkey PRIMARY KEY (id);

--
-- Name: public_price_source public_price_source_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.public_price_source
    ADD CONSTRAINT public_price_source_pkey PRIMARY KEY (fact_id);

--
-- Name: public_price_source public_price_source_price_record_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.public_price_source
    ADD CONSTRAINT public_price_source_price_record_id_key UNIQUE (price_record_id);

--
-- Name: summary_refresh_queue summary_refresh_queue_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.summary_refresh_queue
    ADD CONSTRAINT summary_refresh_queue_pkey PRIMARY KEY (household_id, product_id);

--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

--
-- Name: barcode_assignment barcode_assignment_code_coalesce_coalesce1_daterange_excl; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barcode_assignment
    ADD CONSTRAINT barcode_assignment_code_coalesce_coalesce1_daterange_excl EXCLUDE USING gist (code WITH =, COALESCE(household_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =, daterange(valid_from, valid_until, '[)'::text) WITH &&);

--
-- Name: barcode_assignment barcode_assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barcode_assignment
    ADD CONSTRAINT barcode_assignment_pkey PRIMARY KEY (id);

--
-- Name: branch branch_id_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch
    ADD CONSTRAINT branch_id_store_id_key UNIQUE (id, store_id);

--
-- Name: branch branch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch
    ADD CONSTRAINT branch_pkey PRIMARY KEY (id);

--
-- Name: brand brand_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand
    ADD CONSTRAINT brand_pkey PRIMARY KEY (id);

--
-- Name: capture capture_id_household_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture
    ADD CONSTRAINT capture_id_household_id_key UNIQUE (id, household_id);

--
-- Name: capture_image capture_image_capture_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_image
    ADD CONSTRAINT capture_image_capture_id_position_key UNIQUE (capture_id, "position");

--
-- Name: capture_image capture_image_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_image
    ADD CONSTRAINT capture_image_pkey PRIMARY KEY (id);

--
-- Name: capture_item capture_item_capture_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_capture_id_position_key UNIQUE (capture_id, "position");

--
-- Name: capture_item capture_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_pkey PRIMARY KEY (id);

--
-- Name: capture_item capture_item_price_record_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_price_record_id_key UNIQUE (price_record_id);

--
-- Name: capture capture_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture
    ADD CONSTRAINT capture_pkey PRIMARY KEY (id);

--
-- Name: category category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category
    ADD CONSTRAINT category_pkey PRIMARY KEY (id);

--
-- Name: household_member household_member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_member
    ADD CONSTRAINT household_member_pkey PRIMARY KEY (household_id, user_id);

--
-- Name: household household_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household
    ADD CONSTRAINT household_pkey PRIMARY KEY (id);

--
-- Name: household_program_membership household_program_membership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_program_membership
    ADD CONSTRAINT household_program_membership_pkey PRIMARY KEY (household_id, member_program_id);

--
-- Name: member_program member_program_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_program
    ADD CONSTRAINT member_program_pkey PRIMARY KEY (id);

--
-- Name: member_program member_program_store_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_program
    ADD CONSTRAINT member_program_store_id_name_key UNIQUE (store_id, name);

--
-- Name: price_record price_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_pkey PRIMARY KEY (id);

--
-- Name: price_record price_record_receipt_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_receipt_line_id_key UNIQUE (receipt_line_id);

--
-- Name: price_summary price_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_summary
    ADD CONSTRAINT price_summary_pkey PRIMARY KEY (household_id, product_id);

--
-- Name: processing_run processing_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processing_run
    ADD CONSTRAINT processing_run_pkey PRIMARY KEY (id);

--
-- Name: product_alias product_alias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_alias
    ADD CONSTRAINT product_alias_pkey PRIMARY KEY (id);

--
-- Name: product_group product_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_group
    ADD CONSTRAINT product_group_pkey PRIMARY KEY (id);

--
-- Name: product product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_pkey PRIMARY KEY (id);

--
-- Name: profile profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile
    ADD CONSTRAINT profile_pkey PRIMARY KEY (user_id);

--
-- Name: public_price_fact public_price_fact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_price_fact
    ADD CONSTRAINT public_price_fact_pkey PRIMARY KEY (id);

--
-- Name: receipt_adjustment receipt_adjustment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_adjustment
    ADD CONSTRAINT receipt_adjustment_pkey PRIMARY KEY (id);

--
-- Name: receipt receipt_capture_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt
    ADD CONSTRAINT receipt_capture_id_key UNIQUE (capture_id);

--
-- Name: receipt receipt_id_household_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt
    ADD CONSTRAINT receipt_id_household_id_key UNIQUE (id, household_id);

--
-- Name: receipt_line receipt_line_id_household_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_line
    ADD CONSTRAINT receipt_line_id_household_id_key UNIQUE (id, household_id);

--
-- Name: receipt_line receipt_line_id_receipt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_line
    ADD CONSTRAINT receipt_line_id_receipt_id_key UNIQUE (id, receipt_id);

--
-- Name: receipt_line receipt_line_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_line
    ADD CONSTRAINT receipt_line_pkey PRIMARY KEY (id);

--
-- Name: receipt_line receipt_line_receipt_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_line
    ADD CONSTRAINT receipt_line_receipt_id_line_no_key UNIQUE (receipt_id, line_no) DEFERRABLE INITIALLY DEFERRED;

--
-- Name: receipt receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt
    ADD CONSTRAINT receipt_pkey PRIMARY KEY (id);

--
-- Name: shopping_session shopping_session_id_household_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_session
    ADD CONSTRAINT shopping_session_id_household_id_key UNIQUE (id, household_id);

--
-- Name: shopping_session shopping_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_session
    ADD CONSTRAINT shopping_session_pkey PRIMARY KEY (id);

--
-- Name: store_group store_group_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_group
    ADD CONSTRAINT store_group_name_key UNIQUE (name);

--
-- Name: store_group store_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_group
    ADD CONSTRAINT store_group_pkey PRIMARY KEY (id);

--
-- Name: store store_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT store_pkey PRIMARY KEY (id);

--
-- Name: unit unit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit
    ADD CONSTRAINT unit_pkey PRIMARY KEY (code);

--
-- Name: ask_usage_day_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ask_usage_day_idx ON app.ask_usage USING btree (day);

--
-- Name: job_pending_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX job_pending_idx ON app.job USING btree (run_after) WHERE (status = 'pending'::text);

--
-- Name: audit_log_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_entity_idx ON public.audit_log USING btree (entity_type, entity_id, created_at DESC);

--
-- Name: audit_log_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_household_idx ON public.audit_log USING btree (household_id, created_at DESC);

--
-- Name: barcode_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barcode_code_idx ON public.barcode_assignment USING btree (code);

--
-- Name: barcode_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX barcode_product_idx ON public.barcode_assignment USING btree (product_id);

--
-- Name: branch_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX branch_household_idx ON public.branch USING btree (household_id);

--
-- Name: branch_seller_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX branch_seller_uq ON public.branch USING btree (store_id, external_ref) WHERE ((kind = 'seller'::text) AND (household_id IS NULL));

--
-- Name: branch_store_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX branch_store_idx ON public.branch USING btree (store_id);

--
-- Name: brand_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX brand_name_uq ON public.brand USING btree (household_id, normalized_name) NULLS NOT DISTINCT WHERE (status = 'active'::text);

--
-- Name: capture_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capture_household_idx ON public.capture USING btree (household_id, uploaded_at DESC);

--
-- Name: capture_image_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capture_image_hash_idx ON public.capture_image USING btree (household_id, sha256);

--
-- Name: capture_image_purge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capture_image_purge_idx ON public.capture_image USING btree (purge_after) WHERE (purged_at IS NULL);

--
-- Name: capture_item_capture_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capture_item_capture_idx ON public.capture_item USING btree (capture_id, "position");

--
-- Name: capture_item_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capture_item_pending_idx ON public.capture_item USING btree (household_id) WHERE (status = 'pending'::text);

--
-- Name: capture_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capture_pending_idx ON public.capture USING btree (status, uploaded_at) WHERE (status = ANY (ARRAY['uploaded'::text, 'processing'::text]));

--
-- Name: category_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX category_name_uq ON public.category USING btree (household_id, app.normalize_text(name)) NULLS NOT DISTINCT WHERE (archived_at IS NULL);

--
-- Name: category_slug_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX category_slug_uq ON public.category USING btree (slug) WHERE (household_id IS NULL);

--
-- Name: household_member_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX household_member_user_idx ON public.household_member USING btree (user_id);

--
-- Name: price_record_capture_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_record_capture_idx ON public.price_record USING btree (capture_id) WHERE (capture_id IS NOT NULL);

--
-- Name: price_record_hist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_record_hist_idx ON public.price_record USING btree (household_id, product_id, transaction_date DESC) INCLUDE (unit_price, effective_price, price_basis, store_id, branch_id) WHERE (status = 'active'::text);

--
-- Name: price_record_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_record_product_idx ON public.price_record USING btree (product_id);

--
-- Name: price_record_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_record_recent_idx ON public.price_record USING btree (household_id, transaction_date DESC);

--
-- Name: processing_run_capture_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX processing_run_capture_idx ON public.processing_run USING btree (capture_id, started_at DESC);

--
-- Name: product_alias_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_alias_product_idx ON public.product_alias USING btree (product_id);

--
-- Name: product_alias_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_alias_uq ON public.product_alias USING btree (store_id, normalized_text, household_id) NULLS NOT DISTINCT WHERE (status = 'active'::text);

--
-- Name: product_group_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_group_household_idx ON public.product_group USING btree (household_id);

--
-- Name: product_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_group_idx ON public.product USING btree (product_group_id);

--
-- Name: product_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_household_idx ON public.product USING btree (household_id);

--
-- Name: product_merged_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_merged_idx ON public.product USING btree (merged_into_id) WHERE (merged_into_id IS NOT NULL);

--
-- Name: product_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_search_trgm ON public.product USING gin (search_text extensions.gin_trgm_ops);

--
-- Name: public_price_fact_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_price_fact_product_idx ON public.public_price_fact USING btree (product_id, transaction_date DESC);

--
-- Name: receipt_adjustment_receipt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipt_adjustment_receipt_idx ON public.receipt_adjustment USING btree (receipt_id);

--
-- Name: receipt_fingerprint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipt_fingerprint_idx ON public.receipt USING btree (household_id, store_id, transaction_date, total_amount);

--
-- Name: receipt_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipt_household_idx ON public.receipt USING btree (household_id, transaction_date DESC);

--
-- Name: shopping_session_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shopping_session_active_idx ON public.shopping_session USING btree (household_id, started_at DESC) WHERE (ended_at IS NULL);

--
-- Name: store_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX store_name_uq ON public.store USING btree (household_id, normalized_name) NULLS NOT DISTINCT;

--
-- Name: barcode_assignment barcode_assignment_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barcode_assignment_audit AFTER DELETE OR UPDATE ON public.barcode_assignment FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: barcode_assignment barcode_copy_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barcode_copy_owner BEFORE INSERT OR UPDATE OF product_id ON public.barcode_assignment FOR EACH ROW EXECUTE FUNCTION app.barcode_copy_owner();

--
-- Name: barcode_assignment barcode_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER barcode_ref_visibility BEFORE INSERT OR UPDATE ON public.barcode_assignment FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'store_id:store');

--
-- Name: branch branch_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER branch_audit AFTER DELETE OR UPDATE ON public.branch FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: branch branch_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER branch_ref_visibility BEFORE INSERT OR UPDATE ON public.branch FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'store_id:store', 'successor_branch_id:branch');

--
-- Name: branch branch_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER branch_touch BEFORE UPDATE ON public.branch FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: brand brand_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brand_audit AFTER DELETE OR UPDATE ON public.brand FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: brand brand_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brand_touch BEFORE UPDATE ON public.brand FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: capture_item capture_item_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER capture_item_audit AFTER DELETE OR UPDATE ON public.capture_item FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: capture_item capture_item_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER capture_item_guard BEFORE UPDATE ON public.capture_item FOR EACH ROW EXECUTE FUNCTION app.capture_item_guard();

--
-- Name: capture_item capture_item_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER capture_item_ref_visibility BEFORE INSERT OR UPDATE ON public.capture_item FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'suggested_product_id:product', 'store_id:store', 'branch_id:branch');

--
-- Name: capture_item capture_item_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER capture_item_touch BEFORE UPDATE ON public.capture_item FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: capture capture_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER capture_ref_visibility BEFORE INSERT OR UPDATE ON public.capture FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'store_id:store', 'branch_id:branch');

--
-- Name: capture capture_status_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER capture_status_guard BEFORE INSERT OR UPDATE OF status ON public.capture FOR EACH ROW EXECUTE FUNCTION app.capture_status_guard();

--
-- Name: category category_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER category_audit AFTER DELETE OR UPDATE ON public.category FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: category category_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER category_ref_visibility BEFORE INSERT OR UPDATE ON public.category FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'parent_id:category');

--
-- Name: household household_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER household_touch BEFORE UPDATE ON public.household FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: member_program member_program_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER member_program_ref_visibility BEFORE INSERT OR UPDATE ON public.member_program FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('', 'store_id:store');

--
-- Name: price_record price_record_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER price_record_audit AFTER DELETE OR UPDATE ON public.price_record FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: price_record price_record_default_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER price_record_default_visibility BEFORE INSERT ON public.price_record FOR EACH ROW EXECUTE FUNCTION app.default_visibility();

--
-- Name: price_record price_record_enqueue_summary; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER price_record_enqueue_summary AFTER INSERT OR DELETE OR UPDATE ON public.price_record FOR EACH ROW EXECUTE FUNCTION app.enqueue_summary_refresh();

--
-- Name: price_record price_record_receipt_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER price_record_receipt_guard BEFORE INSERT OR UPDATE ON public.price_record FOR EACH ROW EXECUTE FUNCTION app.price_record_receipt_guard();

--
-- Name: price_record price_record_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER price_record_ref_visibility BEFORE INSERT OR UPDATE ON public.price_record FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'product_id:product', 'store_id:store', 'branch_id:branch');

--
-- Name: price_record price_record_sync_public; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER price_record_sync_public AFTER INSERT OR UPDATE ON public.price_record FOR EACH ROW EXECUTE FUNCTION app.sync_public_fact();

--
-- Name: price_record price_record_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER price_record_touch BEFORE UPDATE ON public.price_record FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: price_record price_record_unit_price; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER price_record_unit_price BEFORE INSERT OR UPDATE ON public.price_record FOR EACH ROW EXECUTE FUNCTION app.compute_unit_price();

--
-- Name: price_record price_record_unsync_public; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER price_record_unsync_public BEFORE DELETE ON public.price_record FOR EACH ROW EXECUTE FUNCTION app.unsync_public_fact();

--
-- Name: product_alias product_alias_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_alias_audit AFTER DELETE OR UPDATE ON public.product_alias FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: product_alias product_alias_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_alias_ref_visibility BEFORE INSERT OR UPDATE ON public.product_alias FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'store_id:store', 'product_id:product');

--
-- Name: product_alias product_alias_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_alias_touch BEFORE UPDATE ON public.product_alias FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: product product_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_audit AFTER DELETE OR UPDATE ON public.product FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: product product_check_merge; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_check_merge BEFORE UPDATE OF status, merged_into_id ON public.product FOR EACH ROW EXECUTE FUNCTION app.check_product_merge();

--
-- Name: product_group product_group_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_group_audit AFTER DELETE OR UPDATE ON public.product_group FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: product_group product_group_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_group_ref_visibility BEFORE INSERT OR UPDATE ON public.product_group FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'brand_id:brand', 'category_id:category');

--
-- Name: product_group product_group_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_group_touch BEFORE UPDATE ON public.product_group FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: product product_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_ref_visibility BEFORE INSERT OR UPDATE ON public.product FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'product_group_id:product_group', 'brand_id:brand', 'category_id:category', 'merged_into_id:product');

--
-- Name: product product_size_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_size_changed AFTER UPDATE OF sale_mode, pack_count, content_size, content_unit ON public.product FOR EACH ROW EXECUTE FUNCTION app.enqueue_unit_price_recompute();

--
-- Name: product product_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_touch BEFORE UPDATE ON public.product FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: profile profile_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profile_touch BEFORE UPDATE ON public.profile FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: receipt_adjustment receipt_adjustment_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER receipt_adjustment_audit AFTER DELETE OR UPDATE ON public.receipt_adjustment FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: receipt receipt_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER receipt_audit AFTER DELETE OR UPDATE ON public.receipt FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: receipt_line receipt_line_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER receipt_line_audit AFTER DELETE OR UPDATE ON public.receipt_line FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: receipt_line receipt_line_derive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER receipt_line_derive AFTER INSERT OR DELETE OR UPDATE ON public.receipt_line FOR EACH ROW EXECUTE FUNCTION app.receipt_line_derive();

--
-- Name: receipt_line receipt_line_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER receipt_line_ref_visibility BEFORE INSERT OR UPDATE ON public.receipt_line FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'suggested_product_id:product');

--
-- Name: receipt_line receipt_line_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER receipt_line_touch BEFORE UPDATE ON public.receipt_line FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: receipt receipt_propagate_header; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER receipt_propagate_header AFTER UPDATE OF transaction_date, store_id, branch_id, currency ON public.receipt FOR EACH ROW EXECUTE FUNCTION app.propagate_receipt_header();

--
-- Name: receipt receipt_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER receipt_ref_visibility BEFORE INSERT OR UPDATE ON public.receipt FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'store_id:store', 'branch_id:branch');

--
-- Name: receipt receipt_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER receipt_touch BEFORE UPDATE ON public.receipt FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: shopping_session shopping_session_ref_visibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER shopping_session_ref_visibility BEFORE INSERT OR UPDATE ON public.shopping_session FOR EACH ROW EXECUTE FUNCTION app.enforce_ref_visibility('household_id', 'branch_id:branch');

--
-- Name: store store_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER store_audit AFTER DELETE OR UPDATE ON public.store FOR EACH ROW EXECUTE FUNCTION app.audit_row();

--
-- Name: store store_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER store_touch BEFORE UPDATE ON public.store FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

--
-- Name: ask_usage ask_usage_household_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.ask_usage
    ADD CONSTRAINT ask_usage_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: public_price_source public_price_source_fact_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.public_price_source
    ADD CONSTRAINT public_price_source_fact_id_fkey FOREIGN KEY (fact_id) REFERENCES public.public_price_fact(id) ON DELETE CASCADE;

--
-- Name: public_price_source public_price_source_price_record_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.public_price_source
    ADD CONSTRAINT public_price_source_price_record_id_fkey FOREIGN KEY (price_record_id) REFERENCES public.price_record(id) ON DELETE CASCADE;

--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: audit_log audit_log_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: barcode_assignment barcode_assignment_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barcode_assignment
    ADD CONSTRAINT barcode_assignment_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: barcode_assignment barcode_assignment_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barcode_assignment
    ADD CONSTRAINT barcode_assignment_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id) ON DELETE CASCADE;

--
-- Name: barcode_assignment barcode_assignment_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.barcode_assignment
    ADD CONSTRAINT barcode_assignment_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.store(id);

--
-- Name: branch branch_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch
    ADD CONSTRAINT branch_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: branch branch_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch
    ADD CONSTRAINT branch_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.store(id);

--
-- Name: branch branch_successor_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch
    ADD CONSTRAINT branch_successor_branch_id_fkey FOREIGN KEY (successor_branch_id) REFERENCES public.branch(id);

--
-- Name: brand brand_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand
    ADD CONSTRAINT brand_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: brand brand_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand
    ADD CONSTRAINT brand_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.brand(id);

--
-- Name: capture capture_branch_id_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture
    ADD CONSTRAINT capture_branch_id_store_id_fkey FOREIGN KEY (branch_id, store_id) REFERENCES public.branch(id, store_id);

--
-- Name: capture capture_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture
    ADD CONSTRAINT capture_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: capture_image capture_image_capture_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_image
    ADD CONSTRAINT capture_image_capture_id_household_id_fkey FOREIGN KEY (capture_id, household_id) REFERENCES public.capture(id, household_id) ON DELETE CASCADE;

--
-- Name: capture_item capture_item_branch_id_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_branch_id_store_id_fkey FOREIGN KEY (branch_id, store_id) REFERENCES public.branch(id, store_id);

--
-- Name: capture_item capture_item_capture_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_capture_id_household_id_fkey FOREIGN KEY (capture_id, household_id) REFERENCES public.capture(id, household_id) ON DELETE CASCADE;

--
-- Name: capture_item capture_item_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: capture_item capture_item_member_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_member_program_id_fkey FOREIGN KEY (member_program_id) REFERENCES public.member_program(id);

--
-- Name: capture_item capture_item_price_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_price_record_id_fkey FOREIGN KEY (price_record_id) REFERENCES public.price_record(id) ON DELETE SET NULL;

--
-- Name: capture_item capture_item_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.store(id);

--
-- Name: capture_item capture_item_suggested_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture_item
    ADD CONSTRAINT capture_item_suggested_product_id_fkey FOREIGN KEY (suggested_product_id) REFERENCES public.product(id);

--
-- Name: capture capture_shopping_session_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture
    ADD CONSTRAINT capture_shopping_session_id_household_id_fkey FOREIGN KEY (shopping_session_id, household_id) REFERENCES public.shopping_session(id, household_id) ON DELETE SET NULL (shopping_session_id);

--
-- Name: capture capture_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture
    ADD CONSTRAINT capture_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.store(id);

--
-- Name: capture capture_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capture
    ADD CONSTRAINT capture_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: category category_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category
    ADD CONSTRAINT category_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: category category_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category
    ADD CONSTRAINT category_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.category(id);

--
-- Name: household_member household_member_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_member
    ADD CONSTRAINT household_member_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: household_member household_member_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_member
    ADD CONSTRAINT household_member_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: household_program_membership household_program_membership_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_program_membership
    ADD CONSTRAINT household_program_membership_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: household_program_membership household_program_membership_member_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_program_membership
    ADD CONSTRAINT household_program_membership_member_program_id_fkey FOREIGN KEY (member_program_id) REFERENCES public.member_program(id);

--
-- Name: member_program member_program_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_program
    ADD CONSTRAINT member_program_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.store(id);

--
-- Name: price_record price_record_branch_id_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_branch_id_store_id_fkey FOREIGN KEY (branch_id, store_id) REFERENCES public.branch(id, store_id);

--
-- Name: price_record price_record_capture_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_capture_id_household_id_fkey FOREIGN KEY (capture_id, household_id) REFERENCES public.capture(id, household_id) ON DELETE SET NULL (capture_id);

--
-- Name: price_record price_record_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: price_record price_record_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: price_record price_record_member_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_member_program_id_fkey FOREIGN KEY (member_program_id) REFERENCES public.member_program(id);

--
-- Name: price_record price_record_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id);

--
-- Name: price_record price_record_receipt_line_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_receipt_line_id_household_id_fkey FOREIGN KEY (receipt_line_id, household_id) REFERENCES public.receipt_line(id, household_id) ON DELETE CASCADE;

--
-- Name: price_record price_record_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_record
    ADD CONSTRAINT price_record_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.store(id);

--
-- Name: price_summary price_summary_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_summary
    ADD CONSTRAINT price_summary_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: price_summary price_summary_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_summary
    ADD CONSTRAINT price_summary_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id) ON DELETE CASCADE;

--
-- Name: processing_run processing_run_capture_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processing_run
    ADD CONSTRAINT processing_run_capture_id_household_id_fkey FOREIGN KEY (capture_id, household_id) REFERENCES public.capture(id, household_id) ON DELETE CASCADE;

--
-- Name: product_alias product_alias_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_alias
    ADD CONSTRAINT product_alias_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: product_alias product_alias_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_alias
    ADD CONSTRAINT product_alias_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id);

--
-- Name: product_alias product_alias_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_alias
    ADD CONSTRAINT product_alias_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.store(id);

--
-- Name: product product_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brand(id);

--
-- Name: product product_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.category(id);

--
-- Name: product product_content_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_content_unit_fkey FOREIGN KEY (content_unit) REFERENCES public.unit(code);

--
-- Name: product_group product_group_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_group
    ADD CONSTRAINT product_group_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brand(id);

--
-- Name: product_group product_group_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_group
    ADD CONSTRAINT product_group_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.category(id);

--
-- Name: product_group product_group_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_group
    ADD CONSTRAINT product_group_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: product_group product_group_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_group
    ADD CONSTRAINT product_group_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.product_group(id);

--
-- Name: product product_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: product product_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.product(id);

--
-- Name: product product_product_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_product_group_id_fkey FOREIGN KEY (product_group_id) REFERENCES public.product_group(id);

--
-- Name: profile profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile
    ADD CONSTRAINT profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: public_price_fact public_price_fact_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_price_fact
    ADD CONSTRAINT public_price_fact_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branch(id);

--
-- Name: public_price_fact public_price_fact_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_price_fact
    ADD CONSTRAINT public_price_fact_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(id) ON DELETE CASCADE;

--
-- Name: public_price_fact public_price_fact_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_price_fact
    ADD CONSTRAINT public_price_fact_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.store(id);

--
-- Name: receipt_adjustment receipt_adjustment_receipt_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_adjustment
    ADD CONSTRAINT receipt_adjustment_receipt_id_household_id_fkey FOREIGN KEY (receipt_id, household_id) REFERENCES public.receipt(id, household_id) ON DELETE CASCADE;

--
-- Name: receipt receipt_branch_id_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt
    ADD CONSTRAINT receipt_branch_id_store_id_fkey FOREIGN KEY (branch_id, store_id) REFERENCES public.branch(id, store_id);

--
-- Name: receipt receipt_capture_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt
    ADD CONSTRAINT receipt_capture_id_household_id_fkey FOREIGN KEY (capture_id, household_id) REFERENCES public.capture(id, household_id) ON DELETE SET NULL (capture_id);

--
-- Name: receipt receipt_duplicate_of_receipt_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt
    ADD CONSTRAINT receipt_duplicate_of_receipt_id_household_id_fkey FOREIGN KEY (duplicate_of_receipt_id, household_id) REFERENCES public.receipt(id, household_id) ON DELETE SET NULL (duplicate_of_receipt_id);

--
-- Name: receipt receipt_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt
    ADD CONSTRAINT receipt_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: receipt_line receipt_line_applies_to_line_id_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_line
    ADD CONSTRAINT receipt_line_applies_to_line_id_receipt_id_fkey FOREIGN KEY (applies_to_line_id, receipt_id) REFERENCES public.receipt_line(id, receipt_id) ON DELETE CASCADE;

--
-- Name: receipt_line receipt_line_receipt_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_line
    ADD CONSTRAINT receipt_line_receipt_id_household_id_fkey FOREIGN KEY (receipt_id, household_id) REFERENCES public.receipt(id, household_id) ON DELETE CASCADE;

--
-- Name: receipt_line receipt_line_suggested_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_line
    ADD CONSTRAINT receipt_line_suggested_product_id_fkey FOREIGN KEY (suggested_product_id) REFERENCES public.product(id);

--
-- Name: receipt receipt_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt
    ADD CONSTRAINT receipt_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.store(id);

--
-- Name: shopping_session shopping_session_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_session
    ADD CONSTRAINT shopping_session_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branch(id);

--
-- Name: shopping_session shopping_session_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_session
    ADD CONSTRAINT shopping_session_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: shopping_session shopping_session_started_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_session
    ADD CONSTRAINT shopping_session_started_by_fkey FOREIGN KEY (started_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: store store_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT store_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.household(id) ON DELETE CASCADE;

--
-- Name: store store_store_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT store_store_group_id_fkey FOREIGN KEY (store_group_id) REFERENCES public.store_group(id);

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: barcode_assignment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.barcode_assignment ENABLE ROW LEVEL SECURITY;

--
-- Name: branch; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branch ENABLE ROW LEVEL SECURITY;

--
-- Name: brand; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand ENABLE ROW LEVEL SECURITY;

--
-- Name: capture; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capture ENABLE ROW LEVEL SECURITY;

--
-- Name: capture_image; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capture_image ENABLE ROW LEVEL SECURITY;

--
-- Name: capture_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capture_item ENABLE ROW LEVEL SECURITY;

--
-- Name: category; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.category ENABLE ROW LEVEL SECURITY;

--
-- Name: household; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.household ENABLE ROW LEVEL SECURITY;

--
-- Name: household_member; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.household_member ENABLE ROW LEVEL SECURITY;

--
-- Name: household_program_membership; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.household_program_membership ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log household_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_read ON public.audit_log FOR SELECT TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: capture_item household_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_read ON public.capture_item FOR SELECT TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: price_summary household_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_read ON public.price_summary FOR SELECT TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: capture household_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_rw ON public.capture TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: capture_image household_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_rw ON public.capture_image TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: household_program_membership household_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_rw ON public.household_program_membership TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: price_record household_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_rw ON public.price_record TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: processing_run household_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_rw ON public.processing_run TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: receipt household_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_rw ON public.receipt TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: receipt_adjustment household_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_rw ON public.receipt_adjustment TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: receipt_line household_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_rw ON public.receipt_line TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: shopping_session household_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_rw ON public.shopping_session TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: capture_item household_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY household_update ON public.capture_item FOR UPDATE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: barcode_assignment hybrid_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_delete ON public.barcode_assignment FOR DELETE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: branch hybrid_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_delete ON public.branch FOR DELETE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: brand hybrid_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_delete ON public.brand FOR DELETE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: category hybrid_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_delete ON public.category FOR DELETE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: product hybrid_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_delete ON public.product FOR DELETE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: product_alias hybrid_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_delete ON public.product_alias FOR DELETE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: product_group hybrid_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_delete ON public.product_group FOR DELETE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: store hybrid_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_delete ON public.store FOR DELETE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: barcode_assignment hybrid_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_insert ON public.barcode_assignment FOR INSERT TO authenticated WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: branch hybrid_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_insert ON public.branch FOR INSERT TO authenticated WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: brand hybrid_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_insert ON public.brand FOR INSERT TO authenticated WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: category hybrid_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_insert ON public.category FOR INSERT TO authenticated WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: product hybrid_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_insert ON public.product FOR INSERT TO authenticated WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: product_alias hybrid_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_insert ON public.product_alias FOR INSERT TO authenticated WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: product_group hybrid_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_insert ON public.product_group FOR INSERT TO authenticated WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: store hybrid_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_insert ON public.store FOR INSERT TO authenticated WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: barcode_assignment hybrid_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_read ON public.barcode_assignment FOR SELECT TO authenticated USING (((household_id IS NULL) OR (household_id IN ( SELECT app.my_household_ids() AS my_household_ids))));

--
-- Name: branch hybrid_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_read ON public.branch FOR SELECT TO authenticated USING (((household_id IS NULL) OR (household_id IN ( SELECT app.my_household_ids() AS my_household_ids))));

--
-- Name: brand hybrid_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_read ON public.brand FOR SELECT TO authenticated USING (((household_id IS NULL) OR (household_id IN ( SELECT app.my_household_ids() AS my_household_ids))));

--
-- Name: category hybrid_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_read ON public.category FOR SELECT TO authenticated USING (((household_id IS NULL) OR (household_id IN ( SELECT app.my_household_ids() AS my_household_ids))));

--
-- Name: product hybrid_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_read ON public.product FOR SELECT TO authenticated USING (((household_id IS NULL) OR (household_id IN ( SELECT app.my_household_ids() AS my_household_ids))));

--
-- Name: product_alias hybrid_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_read ON public.product_alias FOR SELECT TO authenticated USING (((household_id IS NULL) OR (household_id IN ( SELECT app.my_household_ids() AS my_household_ids))));

--
-- Name: product_group hybrid_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_read ON public.product_group FOR SELECT TO authenticated USING (((household_id IS NULL) OR (household_id IN ( SELECT app.my_household_ids() AS my_household_ids))));

--
-- Name: store hybrid_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_read ON public.store FOR SELECT TO authenticated USING (((household_id IS NULL) OR (household_id IN ( SELECT app.my_household_ids() AS my_household_ids))));

--
-- Name: barcode_assignment hybrid_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_update ON public.barcode_assignment FOR UPDATE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: branch hybrid_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_update ON public.branch FOR UPDATE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: brand hybrid_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_update ON public.brand FOR UPDATE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: category hybrid_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_update ON public.category FOR UPDATE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: product hybrid_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_update ON public.product FOR UPDATE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: product_alias hybrid_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_update ON public.product_alias FOR UPDATE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: product_group hybrid_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_update ON public.product_group FOR UPDATE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: store hybrid_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hybrid_update ON public.store FOR UPDATE TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids))) WITH CHECK ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: member_program; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_program ENABLE ROW LEVEL SECURITY;

--
-- Name: household member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_read ON public.household FOR SELECT TO authenticated USING ((id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: household_member member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_read ON public.household_member FOR SELECT TO authenticated USING ((household_id IN ( SELECT app.my_household_ids() AS my_household_ids)));

--
-- Name: household owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_update ON public.household FOR UPDATE TO authenticated USING ((id IN ( SELECT household_member.household_id
   FROM public.household_member
  WHERE ((household_member.user_id = ( SELECT auth.uid() AS uid)) AND (household_member.role = 'owner'::text)))));

--
-- Name: price_record; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_record ENABLE ROW LEVEL SECURITY;

--
-- Name: price_summary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_summary ENABLE ROW LEVEL SECURITY;

--
-- Name: processing_run; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.processing_run ENABLE ROW LEVEL SECURITY;

--
-- Name: product; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product ENABLE ROW LEVEL SECURITY;

--
-- Name: product_alias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_alias ENABLE ROW LEVEL SECURITY;

--
-- Name: product_group; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_group ENABLE ROW LEVEL SECURITY;

--
-- Name: profile; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile ENABLE ROW LEVEL SECURITY;

--
-- Name: public_price_fact; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.public_price_fact ENABLE ROW LEVEL SECURITY;

--
-- Name: public_price_fact public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read ON public.public_price_fact FOR SELECT TO anon, authenticated USING (true);

--
-- Name: receipt; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.receipt ENABLE ROW LEVEL SECURITY;

--
-- Name: receipt_adjustment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.receipt_adjustment ENABLE ROW LEVEL SECURITY;

--
-- Name: receipt_line; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.receipt_line ENABLE ROW LEVEL SECURITY;

--
-- Name: profile self_or_comember_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY self_or_comember_read ON public.profile FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR (user_id IN ( SELECT household_member.user_id
   FROM public.household_member
  WHERE (household_member.household_id IN ( SELECT app.my_household_ids() AS my_household_ids))))));

--
-- Name: profile self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY self_update ON public.profile FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

--
-- Name: shopping_session; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shopping_session ENABLE ROW LEVEL SECURITY;

--
-- Name: store; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store ENABLE ROW LEVEL SECURITY;

--
-- Name: store_group; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_group ENABLE ROW LEVEL SECURITY;

--
-- Name: member_program system_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_read ON public.member_program FOR SELECT TO authenticated USING (true);

--
-- Name: store_group system_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_read ON public.store_group FOR SELECT TO authenticated USING (true);

--
-- Name: unit system_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_read ON public.unit FOR SELECT TO authenticated USING (true);

--
-- Name: unit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA app; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA app TO authenticated;
GRANT USAGE ON SCHEMA app TO service_role;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

--
-- Name: FUNCTION accept_capture_item(p_item_id uuid, p_product_id uuid, p_outcome text, p_create_alias boolean); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.accept_capture_item(p_item_id uuid, p_product_id uuid, p_outcome text, p_create_alias boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app.accept_capture_item(p_item_id uuid, p_product_id uuid, p_outcome text, p_create_alias boolean) TO authenticated;
GRANT ALL ON FUNCTION app.accept_capture_item(p_item_id uuid, p_product_id uuid, p_outcome text, p_create_alias boolean) TO service_role;

--
-- Name: FUNCTION ai_spend_today(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.ai_spend_today() FROM PUBLIC;
GRANT ALL ON FUNCTION app.ai_spend_today() TO service_role;

--
-- Name: FUNCTION apply_extraction(p_capture_id uuid, p_run_id uuid, p_payload jsonb); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.apply_extraction(p_capture_id uuid, p_run_id uuid, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app.apply_extraction(p_capture_id uuid, p_run_id uuid, p_payload jsonb) TO service_role;

--
-- Name: FUNCTION apply_redaction(p_run_id uuid, p_raw_ocr_text text, p_raw_ai_output jsonb); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.apply_redaction(p_run_id uuid, p_raw_ocr_text text, p_raw_ai_output jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app.apply_redaction(p_run_id uuid, p_raw_ocr_text text, p_raw_ai_output jsonb) TO service_role;

--
-- Name: FUNCTION audit_row(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.audit_row() FROM PUBLIC;
GRANT ALL ON FUNCTION app.audit_row() TO service_role;

--
-- Name: FUNCTION barcode_copy_owner(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.barcode_copy_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION app.barcode_copy_owner() TO service_role;

--
-- Name: FUNCTION base_unit(p_dimension text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.base_unit(p_dimension text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.base_unit(p_dimension text) TO authenticated;
GRANT ALL ON FUNCTION app.base_unit(p_dimension text) TO service_role;

--
-- Name: FUNCTION begin_account_deletion(p_user_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.begin_account_deletion(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.begin_account_deletion(p_user_id uuid) TO service_role;

--
-- Name: FUNCTION best_unit_price_excluding(p_product uuid, p_household uuid, p_capture_ids uuid[]); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.best_unit_price_excluding(p_product uuid, p_household uuid, p_capture_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app.best_unit_price_excluding(p_product uuid, p_household uuid, p_capture_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION app.best_unit_price_excluding(p_product uuid, p_household uuid, p_capture_ids uuid[]) TO service_role;

--
-- Name: FUNCTION branch_json(p_branch_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.branch_json(p_branch_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.branch_json(p_branch_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app.branch_json(p_branch_id uuid) TO service_role;

--
-- Name: FUNCTION capture_item_guard(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.capture_item_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION app.capture_item_guard() TO service_role;

--
-- Name: FUNCTION capture_item_json(p_item_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.capture_item_json(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.capture_item_json(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app.capture_item_json(p_item_id uuid) TO service_role;

--
-- Name: FUNCTION capture_location(p_capture_id uuid, p_store_name text, p_branch_name text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.capture_location(p_capture_id uuid, p_store_name text, p_branch_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.capture_location(p_capture_id uuid, p_store_name text, p_branch_name text) TO service_role;

--
-- Name: FUNCTION capture_round_runs(p_capture_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.capture_round_runs(p_capture_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.capture_round_runs(p_capture_id uuid) TO service_role;

--
-- Name: FUNCTION capture_status_guard(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.capture_status_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION app.capture_status_guard() TO service_role;

--
-- Name: FUNCTION check_patch_keys(p_patch jsonb, p_allowed text[]); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.check_patch_keys(p_patch jsonb, p_allowed text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app.check_patch_keys(p_patch jsonb, p_allowed text[]) TO authenticated;
GRANT ALL ON FUNCTION app.check_patch_keys(p_patch jsonb, p_allowed text[]) TO service_role;

--
-- Name: FUNCTION check_product_merge(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.check_product_merge() FROM PUBLIC;
GRANT ALL ON FUNCTION app.check_product_merge() TO service_role;

--
-- Name: TABLE job; Type: ACL; Schema: app; Owner: -
--

GRANT ALL ON TABLE app.job TO service_role;

--
-- Name: FUNCTION claim_job(p_kinds text[], p_lease_seconds integer); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.claim_job(p_kinds text[], p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app.claim_job(p_kinds text[], p_lease_seconds integer) TO service_role;

--
-- Name: FUNCTION claim_next_capture(p_worker text, p_engine text, p_model text, p_prompt_version text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.claim_next_capture(p_worker text, p_engine text, p_model text, p_prompt_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.claim_next_capture(p_worker text, p_engine text, p_model text, p_prompt_version text) TO service_role;

--
-- Name: FUNCTION complete_job(p_job_id bigint, p_note text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.complete_job(p_job_id bigint, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.complete_job(p_job_id bigint, p_note text) TO service_role;

--
-- Name: FUNCTION compute_unit_price(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.compute_unit_price() FROM PUBLIC;
GRANT ALL ON FUNCTION app.compute_unit_price() TO service_role;

--
-- Name: FUNCTION config_int(p_key text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.config_int(p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.config_int(p_key text) TO service_role;

--
-- Name: FUNCTION config_json(p_key text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.config_json(p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.config_json(p_key text) TO authenticated;
GRANT ALL ON FUNCTION app.config_json(p_key text) TO service_role;

--
-- Name: FUNCTION config_numeric(p_key text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.config_numeric(p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.config_numeric(p_key text) TO authenticated;
GRANT ALL ON FUNCTION app.config_numeric(p_key text) TO service_role;

--
-- Name: FUNCTION default_visibility(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.default_visibility() FROM PUBLIC;
GRANT ALL ON FUNCTION app.default_visibility() TO service_role;

--
-- Name: FUNCTION derive_receipt_price(p_line_id uuid, p_product_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.derive_receipt_price(p_line_id uuid, p_product_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.derive_receipt_price(p_line_id uuid, p_product_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app.derive_receipt_price(p_line_id uuid, p_product_id uuid) TO service_role;

--
-- Name: FUNCTION detach_public_facts(p_household uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.detach_public_facts(p_household uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.detach_public_facts(p_household uuid) TO service_role;

--
-- Name: FUNCTION enforce_ref_visibility(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.enforce_ref_visibility() FROM PUBLIC;
GRANT ALL ON FUNCTION app.enforce_ref_visibility() TO service_role;

--
-- Name: FUNCTION enqueue_retention(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.enqueue_retention() FROM PUBLIC;
GRANT ALL ON FUNCTION app.enqueue_retention() TO service_role;

--
-- Name: FUNCTION enqueue_storage_purge(p_household uuid, p_paths text[]); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.enqueue_storage_purge(p_household uuid, p_paths text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app.enqueue_storage_purge(p_household uuid, p_paths text[]) TO authenticated;
GRANT ALL ON FUNCTION app.enqueue_storage_purge(p_household uuid, p_paths text[]) TO service_role;

--
-- Name: FUNCTION enqueue_summary_refresh(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.enqueue_summary_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION app.enqueue_summary_refresh() TO service_role;

--
-- Name: FUNCTION enqueue_time_based_refresh(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.enqueue_time_based_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION app.enqueue_time_based_refresh() TO service_role;

--
-- Name: FUNCTION enqueue_unit_price_recompute(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.enqueue_unit_price_recompute() FROM PUBLIC;
GRANT ALL ON FUNCTION app.enqueue_unit_price_recompute() TO service_role;

--
-- Name: FUNCTION err(p_code text, p_detail jsonb); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.err(p_code text, p_detail jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app.err(p_code text, p_detail jsonb) TO service_role;
GRANT ALL ON FUNCTION app.err(p_code text, p_detail jsonb) TO authenticated;

--
-- Name: FUNCTION fail_job(p_job_id bigint, p_error text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.fail_job(p_job_id bigint, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.fail_job(p_job_id bigint, p_error text) TO service_role;

--
-- Name: FUNCTION fail_run(p_run_id uuid, p_error_code text, p_message text, p_transient boolean); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.fail_run(p_run_id uuid, p_error_code text, p_message text, p_transient boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app.fail_run(p_run_id uuid, p_error_code text, p_message text, p_transient boolean) TO service_role;

--
-- Name: FUNCTION finish_household_deletion(p_household uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.finish_household_deletion(p_household uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.finish_household_deletion(p_household uuid) TO service_role;

--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION app.handle_new_user() TO service_role;

--
-- Name: FUNCTION household_today(p_household uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.household_today(p_household uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.household_today(p_household uuid) TO authenticated;
GRANT ALL ON FUNCTION app.household_today(p_household uuid) TO service_role;

--
-- Name: FUNCTION images_to_purge(p_image_ids uuid[]); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.images_to_purge(p_image_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app.images_to_purge(p_image_ids uuid[]) TO service_role;

--
-- Name: FUNCTION jsonb_value_eq(a jsonb, b jsonb); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.jsonb_value_eq(a jsonb, b jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app.jsonb_value_eq(a jsonb, b jsonb) TO authenticated;
GRANT ALL ON FUNCTION app.jsonb_value_eq(a jsonb, b jsonb) TO service_role;

--
-- Name: FUNCTION mark_images_purged(p_image_ids uuid[]); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.mark_images_purged(p_image_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app.mark_images_purged(p_image_ids uuid[]) TO service_role;

--
-- Name: FUNCTION mark_rpc(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.mark_rpc() FROM PUBLIC;
GRANT ALL ON FUNCTION app.mark_rpc() TO authenticated;
GRANT ALL ON FUNCTION app.mark_rpc() TO service_role;

--
-- Name: FUNCTION match_member_program(p_store uuid, p_name text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.match_member_program(p_store uuid, p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.match_member_program(p_store uuid, p_name text) TO authenticated;
GRANT ALL ON FUNCTION app.match_member_program(p_store uuid, p_name text) TO service_role;

--
-- Name: FUNCTION match_products(p_household uuid, p_store_id uuid, p_items jsonb); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.match_products(p_household uuid, p_store_id uuid, p_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app.match_products(p_household uuid, p_store_id uuid, p_items jsonb) TO service_role;

--
-- Name: FUNCTION missing_storage_paths(p_household uuid, p_paths text[]); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.missing_storage_paths(p_household uuid, p_paths text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app.missing_storage_paths(p_household uuid, p_paths text[]) TO authenticated;
GRANT ALL ON FUNCTION app.missing_storage_paths(p_household uuid, p_paths text[]) TO service_role;

--
-- Name: TABLE household; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.household TO service_role;
GRANT SELECT ON TABLE public.household TO authenticated;

--
-- Name: COLUMN household.name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(name) ON TABLE public.household TO authenticated;

--
-- Name: COLUMN household.default_currency; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(default_currency) ON TABLE public.household TO authenticated;

--
-- Name: COLUMN household.timezone; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(timezone) ON TABLE public.household TO authenticated;

--
-- Name: FUNCTION my_household(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.my_household() FROM PUBLIC;
GRANT ALL ON FUNCTION app.my_household() TO authenticated;
GRANT ALL ON FUNCTION app.my_household() TO service_role;

--
-- Name: FUNCTION my_household_ids(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.my_household_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION app.my_household_ids() TO service_role;
GRANT ALL ON FUNCTION app.my_household_ids() TO authenticated;

--
-- Name: FUNCTION normalize_text(t text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.normalize_text(t text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.normalize_text(t text) TO anon;
GRANT ALL ON FUNCTION app.normalize_text(t text) TO authenticated;
GRANT ALL ON FUNCTION app.normalize_text(t text) TO service_role;

--
-- Name: FUNCTION observation_price(p_household uuid, p_date date, p_normal numeric, p_promo numeric, p_promo_from date, p_promo_until date, p_member numeric, p_member_program uuid, p_member_eligible boolean); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.observation_price(p_household uuid, p_date date, p_normal numeric, p_promo numeric, p_promo_from date, p_promo_until date, p_member numeric, p_member_program uuid, p_member_eligible boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app.observation_price(p_household uuid, p_date date, p_normal numeric, p_promo numeric, p_promo_from date, p_promo_until date, p_member numeric, p_member_program uuid, p_member_eligible boolean) TO authenticated;
GRANT ALL ON FUNCTION app.observation_price(p_household uuid, p_date date, p_normal numeric, p_promo numeric, p_promo_from date, p_promo_until date, p_member numeric, p_member_program uuid, p_member_eligible boolean) TO service_role;

--
-- Name: FUNCTION orphan_storage_objects(p_limit integer); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.orphan_storage_objects(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app.orphan_storage_objects(p_limit integer) TO service_role;

--
-- Name: FUNCTION prepare_household_deletion(p_household uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.prepare_household_deletion(p_household uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.prepare_household_deletion(p_household uuid) TO service_role;

--
-- Name: FUNCTION price_point(p_record_id uuid, p_effective numeric, p_unit numeric, p_basis text, p_date date, p_store_id uuid, p_branch_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.price_point(p_record_id uuid, p_effective numeric, p_unit numeric, p_basis text, p_date date, p_store_id uuid, p_branch_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.price_point(p_record_id uuid, p_effective numeric, p_unit numeric, p_basis text, p_date date, p_store_id uuid, p_branch_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app.price_point(p_record_id uuid, p_effective numeric, p_unit numeric, p_basis text, p_date date, p_store_id uuid, p_branch_id uuid) TO service_role;

--
-- Name: FUNCTION price_record_receipt_guard(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.price_record_receipt_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION app.price_record_receipt_guard() TO service_role;

--
-- Name: FUNCTION process_summary_queue(p_limit integer); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.process_summary_queue(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app.process_summary_queue(p_limit integer) TO service_role;

--
-- Name: FUNCTION product_card(p_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.product_card(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.product_card(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app.product_card(p_id uuid) TO service_role;

--
-- Name: FUNCTION product_lite(p_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.product_lite(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.product_lite(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app.product_lite(p_id uuid) TO service_role;

--
-- Name: FUNCTION promote_aliases(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.promote_aliases() FROM PUBLIC;
GRANT ALL ON FUNCTION app.promote_aliases() TO service_role;

--
-- Name: FUNCTION propagate_receipt_header(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.propagate_receipt_header() FROM PUBLIC;
GRANT ALL ON FUNCTION app.propagate_receipt_header() TO service_role;

--
-- Name: FUNCTION reap_stale_runs(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.reap_stale_runs() FROM PUBLIC;
GRANT ALL ON FUNCTION app.reap_stale_runs() TO service_role;

--
-- Name: FUNCTION receipt_duplicate(p_receipt_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.receipt_duplicate(p_receipt_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.receipt_duplicate(p_receipt_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app.receipt_duplicate(p_receipt_id uuid) TO service_role;

--
-- Name: FUNCTION receipt_line_derive(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.receipt_line_derive() FROM PUBLIC;
GRANT ALL ON FUNCTION app.receipt_line_derive() TO service_role;

--
-- Name: FUNCTION recompute_unit_prices(p_product uuid, p_batch integer); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.recompute_unit_prices(p_product uuid, p_batch integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app.recompute_unit_prices(p_product uuid, p_batch integer) TO service_role;

--
-- Name: FUNCTION record_run_output(p_run_id uuid, p_raw_text text, p_raw_output jsonb, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.record_run_output(p_run_id uuid, p_raw_text text, p_raw_output jsonb, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION app.record_run_output(p_run_id uuid, p_raw_text text, p_raw_output jsonb, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric) TO service_role;

--
-- Name: FUNCTION refresh_price_summary(p_household uuid, p_product uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.refresh_price_summary(p_household uuid, p_product uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.refresh_price_summary(p_household uuid, p_product uuid) TO service_role;

--
-- Name: FUNCTION requeue_job(p_job_id bigint, p_delay_seconds integer, p_error text, p_payload jsonb); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.requeue_job(p_job_id bigint, p_delay_seconds integer, p_error text, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app.requeue_job(p_job_id bigint, p_delay_seconds integer, p_error text, p_payload jsonb) TO service_role;

--
-- Name: FUNCTION require_household(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.require_household() FROM PUBLIC;
GRANT ALL ON FUNCTION app.require_household() TO authenticated;
GRANT ALL ON FUNCTION app.require_household() TO service_role;

--
-- Name: FUNCTION require_owner(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.require_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION app.require_owner() TO authenticated;
GRANT ALL ON FUNCTION app.require_owner() TO service_role;

--
-- Name: FUNCTION resolve_product(p_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.resolve_product(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.resolve_product(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app.resolve_product(p_id uuid) TO service_role;

--
-- Name: FUNCTION resolve_store(p_household uuid, p_store_name text, p_branch_name text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.resolve_store(p_household uuid, p_store_name text, p_branch_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.resolve_store(p_household uuid, p_store_name text, p_branch_name text) TO service_role;

--
-- Name: FUNCTION run_sql_jobs(p_limit integer); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.run_sql_jobs(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app.run_sql_jobs(p_limit integer) TO service_role;

--
-- Name: FUNCTION runs_to_redact(p_run_ids uuid[]); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.runs_to_redact(p_run_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app.runs_to_redact(p_run_ids uuid[]) TO service_role;

--
-- Name: FUNCTION set_receipt_state(p_receipt_id uuid, p_status text, p_duplicate_of uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.set_receipt_state(p_receipt_id uuid, p_status text, p_duplicate_of uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.set_receipt_state(p_receipt_id uuid, p_status text, p_duplicate_of uuid) TO authenticated;
GRANT ALL ON FUNCTION app.set_receipt_state(p_receipt_id uuid, p_status text, p_duplicate_of uuid) TO service_role;

--
-- Name: FUNCTION share_existing_batch(p_household uuid, p_limit integer); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.share_existing_batch(p_household uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app.share_existing_batch(p_household uuid, p_limit integer) TO service_role;

--
-- Name: FUNCTION store_json(p_store_id uuid); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.store_json(p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app.store_json(p_store_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app.store_json(p_store_id uuid) TO service_role;

--
-- Name: FUNCTION sync_public_fact(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.sync_public_fact() FROM PUBLIC;
GRANT ALL ON FUNCTION app.sync_public_fact() TO service_role;

--
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.touch_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION app.touch_updated_at() TO service_role;

--
-- Name: FUNCTION unit_price_for(p_product_id uuid, p_price numeric); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.unit_price_for(p_product_id uuid, p_price numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION app.unit_price_for(p_product_id uuid, p_price numeric) TO authenticated;
GRANT ALL ON FUNCTION app.unit_price_for(p_product_id uuid, p_price numeric) TO service_role;

--
-- Name: FUNCTION unsync_public_fact(); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.unsync_public_fact() FROM PUBLIC;
GRANT ALL ON FUNCTION app.unsync_public_fact() TO service_role;

--
-- Name: FUNCTION upsert_household_alias(p_household uuid, p_store_id uuid, p_product_id uuid, p_text text); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.upsert_household_alias(p_household uuid, p_store_id uuid, p_product_id uuid, p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION app.upsert_household_alias(p_household uuid, p_store_id uuid, p_product_id uuid, p_text text) TO authenticated;
GRANT ALL ON FUNCTION app.upsert_household_alias(p_household uuid, p_store_id uuid, p_product_id uuid, p_text text) TO service_role;

--
-- Name: FUNCTION upsert_receipt_record(p_line_id uuid, p_product_id uuid, p_outcome text, p_is_bundle boolean); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.upsert_receipt_record(p_line_id uuid, p_product_id uuid, p_outcome text, p_is_bundle boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app.upsert_receipt_record(p_line_id uuid, p_product_id uuid, p_outcome text, p_is_bundle boolean) TO authenticated;
GRANT ALL ON FUNCTION app.upsert_receipt_record(p_line_id uuid, p_product_id uuid, p_outcome text, p_is_bundle boolean) TO service_role;

--
-- Name: FUNCTION valid_confidence_map(p_map jsonb, p_keys text[]); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.valid_confidence_map(p_map jsonb, p_keys text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app.valid_confidence_map(p_map jsonb, p_keys text[]) TO authenticated;
GRANT ALL ON FUNCTION app.valid_confidence_map(p_map jsonb, p_keys text[]) TO service_role;

--
-- Name: FUNCTION valid_price_extra(p jsonb); Type: ACL; Schema: app; Owner: -
--

REVOKE ALL ON FUNCTION app.valid_price_extra(p jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app.valid_price_extra(p jsonb) TO authenticated;
GRANT ALL ON FUNCTION app.valid_price_extra(p jsonb) TO service_role;

--
-- Name: FUNCTION begin_account_deletion(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.begin_account_deletion(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.begin_account_deletion(p_user_id uuid) TO service_role;

--
-- Name: FUNCTION begin_ask(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.begin_ask() FROM PUBLIC;
GRANT ALL ON FUNCTION public.begin_ask() TO service_role;
GRANT ALL ON FUNCTION public.begin_ask() TO authenticated;

--
-- Name: FUNCTION compare_sizes(p_group_id uuid, p_window text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.compare_sizes(p_group_id uuid, p_window text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.compare_sizes(p_group_id uuid, p_window text) TO service_role;
GRANT ALL ON FUNCTION public.compare_sizes(p_group_id uuid, p_window text) TO authenticated;

--
-- Name: FUNCTION confirm_capture_items(p_capture_id uuid, p_items jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_capture_items(p_capture_id uuid, p_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_capture_items(p_capture_id uuid, p_items jsonb) TO service_role;
GRANT ALL ON FUNCTION public.confirm_capture_items(p_capture_id uuid, p_items jsonb) TO authenticated;

--
-- Name: FUNCTION confirm_receipt(p_receipt_id uuid, p_lines jsonb, p_duplicate_decision text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_receipt(p_receipt_id uuid, p_lines jsonb, p_duplicate_decision text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_receipt(p_receipt_id uuid, p_lines jsonb, p_duplicate_decision text) TO service_role;
GRANT ALL ON FUNCTION public.confirm_receipt(p_receipt_id uuid, p_lines jsonb, p_duplicate_decision text) TO authenticated;

--
-- Name: FUNCTION correct_price_record(p_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone, p_update_alias boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.correct_price_record(p_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone, p_update_alias boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.correct_price_record(p_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone, p_update_alias boolean) TO service_role;
GRANT ALL ON FUNCTION public.correct_price_record(p_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone, p_update_alias boolean) TO authenticated;

--
-- Name: FUNCTION correct_receipt_line(p_line_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.correct_receipt_line(p_line_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.correct_receipt_line(p_line_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.correct_receipt_line(p_line_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone) TO authenticated;

--
-- Name: FUNCTION create_private_branch(p_branch jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_private_branch(p_branch jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_private_branch(p_branch jsonb) TO service_role;
GRANT ALL ON FUNCTION public.create_private_branch(p_branch jsonb) TO authenticated;

--
-- Name: FUNCTION create_private_product(p_product jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_private_product(p_product jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_private_product(p_product jsonb) TO service_role;
GRANT ALL ON FUNCTION public.create_private_product(p_product jsonb) TO authenticated;

--
-- Name: FUNCTION create_private_store(p_store jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_private_store(p_store jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_private_store(p_store jsonb) TO service_role;
GRANT ALL ON FUNCTION public.create_private_store(p_store jsonb) TO authenticated;

--
-- Name: FUNCTION delete_capture(p_capture_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_capture(p_capture_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_capture(p_capture_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.delete_capture(p_capture_id uuid) TO authenticated;

--
-- Name: FUNCTION end_shopping_session(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.end_shopping_session(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.end_shopping_session(p_session_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.end_shopping_session(p_session_id uuid) TO authenticated;

--
-- Name: FUNCTION extend_shopping_session(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.extend_shopping_session(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.extend_shopping_session(p_session_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.extend_shopping_session(p_session_id uuid) TO authenticated;

--
-- Name: FUNCTION find_product_by_barcode(p_code text, p_store_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.find_product_by_barcode(p_code text, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_product_by_barcode(p_code text, p_store_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.find_product_by_barcode(p_code text, p_store_id uuid) TO authenticated;

--
-- Name: FUNCTION get_active_session(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_active_session() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_active_session() TO service_role;
GRANT ALL ON FUNCTION public.get_active_session() TO authenticated;

--
-- Name: FUNCTION get_capture(p_capture_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_capture(p_capture_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_capture(p_capture_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_capture(p_capture_id uuid) TO authenticated;

--
-- Name: FUNCTION get_capture_items(p_capture_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_capture_items(p_capture_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_capture_items(p_capture_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_capture_items(p_capture_id uuid) TO authenticated;

--
-- Name: FUNCTION get_client_config(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_client_config() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_client_config() TO service_role;
GRANT ALL ON FUNCTION public.get_client_config() TO authenticated;

--
-- Name: FUNCTION get_my_context(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_context() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_context() TO service_role;
GRANT ALL ON FUNCTION public.get_my_context() TO authenticated;

--
-- Name: FUNCTION get_my_programs(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_programs() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_programs() TO service_role;
GRANT ALL ON FUNCTION public.get_my_programs() TO authenticated;

--
-- Name: FUNCTION get_offline_cache(p_viewed_ids uuid[], p_top integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_offline_cache(p_viewed_ids uuid[], p_top integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_offline_cache(p_viewed_ids uuid[], p_top integer) TO service_role;
GRANT ALL ON FUNCTION public.get_offline_cache(p_viewed_ids uuid[], p_top integer) TO authenticated;

--
-- Name: FUNCTION get_product_cards(p_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_product_cards(p_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_product_cards(p_ids uuid[]) TO service_role;
GRANT ALL ON FUNCTION public.get_product_cards(p_ids uuid[]) TO authenticated;

--
-- Name: FUNCTION get_product_detail(p_product_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_product_detail(p_product_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_product_detail(p_product_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_product_detail(p_product_id uuid) TO authenticated;

--
-- Name: FUNCTION get_receipt(p_receipt_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_receipt(p_receipt_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_receipt(p_receipt_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_receipt(p_receipt_id uuid) TO authenticated;

--
-- Name: FUNCTION list_captures(p_limit integer, p_before timestamp with time zone, p_kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_captures(p_limit integer, p_before timestamp with time zone, p_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_captures(p_limit integer, p_before timestamp with time zone, p_kind text) TO service_role;
GRANT ALL ON FUNCTION public.list_captures(p_limit integer, p_before timestamp with time zone, p_kind text) TO authenticated;

--
-- Name: FUNCTION merge_product(p_from uuid, p_into uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.merge_product(p_from uuid, p_into uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_product(p_from uuid, p_into uuid) TO authenticated;
GRANT ALL ON FUNCTION public.merge_product(p_from uuid, p_into uuid) TO service_role;

--
-- Name: FUNCTION merge_product_preview(p_from uuid, p_into uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.merge_product_preview(p_from uuid, p_into uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_product_preview(p_from uuid, p_into uuid) TO service_role;
GRANT ALL ON FUNCTION public.merge_product_preview(p_from uuid, p_into uuid) TO authenticated;

--
-- Name: FUNCTION move_price_records(p_record_ids uuid[], p_target_product_id uuid, p_alias jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_price_records(p_record_ids uuid[], p_target_product_id uuid, p_alias jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_price_records(p_record_ids uuid[], p_target_product_id uuid, p_alias jsonb) TO service_role;
GRANT ALL ON FUNCTION public.move_price_records(p_record_ids uuid[], p_target_product_id uuid, p_alias jsonb) TO authenticated;

--
-- Name: FUNCTION price_chart(p_product_id uuid, p_normal_only boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.price_chart(p_product_id uuid, p_normal_only boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.price_chart(p_product_id uuid, p_normal_only boolean) TO service_role;
GRANT ALL ON FUNCTION public.price_chart(p_product_id uuid, p_normal_only boolean) TO authenticated;

--
-- Name: TABLE branch; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.branch TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.branch TO authenticated;

--
-- Name: TABLE member_program; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_program TO service_role;
GRANT SELECT ON TABLE public.member_program TO authenticated;

--
-- Name: TABLE price_record; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.price_record TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.price_record TO authenticated;

--
-- Name: TABLE product; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product TO authenticated;

--
-- Name: TABLE receipt_line; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.receipt_line TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.receipt_line TO authenticated;

--
-- Name: TABLE store; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.store TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.store TO authenticated;

--
-- Name: TABLE unit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unit TO service_role;
GRANT SELECT ON TABLE public.unit TO authenticated;
GRANT SELECT ON TABLE public.unit TO anon;

--
-- Name: TABLE price_record_view; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.price_record_view TO service_role;
GRANT SELECT ON TABLE public.price_record_view TO authenticated;

--
-- Name: FUNCTION price_history(p_product_id uuid, p_include_void boolean, p_store_id uuid, p_limit integer, p_before_date date, p_before_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.price_history(p_product_id uuid, p_include_void boolean, p_store_id uuid, p_limit integer, p_before_date date, p_before_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.price_history(p_product_id uuid, p_include_void boolean, p_store_id uuid, p_limit integer, p_before_date date, p_before_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.price_history(p_product_id uuid, p_include_void boolean, p_store_id uuid, p_limit integer, p_before_date date, p_before_id uuid) TO authenticated;

--
-- Name: FUNCTION price_record_detail(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.price_record_detail(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.price_record_detail(p_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.price_record_detail(p_id uuid) TO authenticated;

--
-- Name: FUNCTION price_trend(p_product_id uuid, p_normal_only boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.price_trend(p_product_id uuid, p_normal_only boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.price_trend(p_product_id uuid, p_normal_only boolean) TO service_role;
GRANT ALL ON FUNCTION public.price_trend(p_product_id uuid, p_normal_only boolean) TO authenticated;

--
-- Name: FUNCTION recent_locations(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recent_locations(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recent_locations(p_limit integer) TO service_role;
GRANT ALL ON FUNCTION public.recent_locations(p_limit integer) TO authenticated;

--
-- Name: FUNCTION record_ask_usage(p_day date, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_ask_usage(p_day date, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_ask_usage(p_day date, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric) TO service_role;
GRANT ALL ON FUNCTION public.record_ask_usage(p_day date, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric) TO authenticated;

--
-- Name: FUNCTION retry_capture(p_capture_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.retry_capture(p_capture_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retry_capture(p_capture_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.retry_capture(p_capture_id uuid) TO authenticated;

--
-- Name: FUNCTION search_products(p_query text, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.search_products(p_query text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.search_products(p_query text, p_limit integer) TO service_role;
GRANT ALL ON FUNCTION public.search_products(p_query text, p_limit integer) TO authenticated;

--
-- Name: FUNCTION set_program_membership(p_program_id uuid, p_member boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_program_membership(p_program_id uuid, p_member boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_program_membership(p_program_id uuid, p_member boolean) TO service_role;
GRANT ALL ON FUNCTION public.set_program_membership(p_program_id uuid, p_member boolean) TO authenticated;

--
-- Name: FUNCTION set_share_prices_public(p_enabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_share_prices_public(p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_share_prices_public(p_enabled boolean) TO service_role;
GRANT ALL ON FUNCTION public.set_share_prices_public(p_enabled boolean) TO authenticated;

--
-- Name: FUNCTION share_existing_prices(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.share_existing_prices() FROM PUBLIC;
GRANT ALL ON FUNCTION public.share_existing_prices() TO service_role;
GRANT ALL ON FUNCTION public.share_existing_prices() TO authenticated;

--
-- Name: FUNCTION start_shopping_session(p_session_id uuid, p_branch_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.start_shopping_session(p_session_id uuid, p_branch_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_shopping_session(p_session_id uuid, p_branch_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.start_shopping_session(p_session_id uuid, p_branch_id uuid) TO authenticated;

--
-- Name: FUNCTION submit_capture(p_capture_id uuid, p_kind text, p_images jsonb, p_shopping_session_id uuid, p_store_id uuid, p_branch_id uuid, p_captured_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_capture(p_capture_id uuid, p_kind text, p_images jsonb, p_shopping_session_id uuid, p_store_id uuid, p_branch_id uuid, p_captured_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_capture(p_capture_id uuid, p_kind text, p_images jsonb, p_shopping_session_id uuid, p_store_id uuid, p_branch_id uuid, p_captured_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.submit_capture(p_capture_id uuid, p_kind text, p_images jsonb, p_shopping_session_id uuid, p_store_id uuid, p_branch_id uuid, p_captured_at timestamp with time zone) TO authenticated;

--
-- Name: FUNCTION update_capture_item(p_item_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_capture_item(p_item_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_capture_item(p_item_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.update_capture_item(p_item_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone) TO authenticated;

--
-- Name: FUNCTION where_cheaper(p_product_id uuid, p_group_id uuid, p_window_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.where_cheaper(p_product_id uuid, p_group_id uuid, p_window_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.where_cheaper(p_product_id uuid, p_group_id uuid, p_window_days integer) TO service_role;
GRANT ALL ON FUNCTION public.where_cheaper(p_product_id uuid, p_group_id uuid, p_window_days integer) TO authenticated;

--
-- Name: TABLE ask_usage; Type: ACL; Schema: app; Owner: -
--

GRANT ALL ON TABLE app.ask_usage TO service_role;

--
-- Name: TABLE config; Type: ACL; Schema: app; Owner: -
--

GRANT ALL ON TABLE app.config TO service_role;

--
-- Name: SEQUENCE job_id_seq; Type: ACL; Schema: app; Owner: -
--

GRANT ALL ON SEQUENCE app.job_id_seq TO service_role;

--
-- Name: TABLE match_quality_daily; Type: ACL; Schema: app; Owner: -
--

GRANT ALL ON TABLE app.match_quality_daily TO service_role;

--
-- Name: TABLE public_price_source; Type: ACL; Schema: app; Owner: -
--

GRANT ALL ON TABLE app.public_price_source TO service_role;

--
-- Name: TABLE summary_refresh_queue; Type: ACL; Schema: app; Owner: -
--

GRANT ALL ON TABLE app.summary_refresh_queue TO service_role;

--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_log TO service_role;
GRANT SELECT ON TABLE public.audit_log TO authenticated;

--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;

--
-- Name: TABLE barcode_assignment; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.barcode_assignment TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.barcode_assignment TO authenticated;

--
-- Name: TABLE brand; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.brand TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brand TO authenticated;

--
-- Name: TABLE capture; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.capture TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.capture TO authenticated;

--
-- Name: TABLE capture_image; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.capture_image TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.capture_image TO authenticated;

--
-- Name: TABLE capture_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.capture_item TO service_role;
GRANT SELECT ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.suggested_product_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(suggested_product_id) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.match_tier; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(match_tier) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.store_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(store_id) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.branch_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(branch_id) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.seller_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(seller_name) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.seller_ref; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(seller_ref) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.transaction_date; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(transaction_date) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.currency; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(currency) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.normal_price; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(normal_price) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.promo_price; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(promo_price) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.promo_min_qty; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(promo_min_qty) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.promo_valid_from; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(promo_valid_from) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.promo_valid_until; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(promo_valid_until) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.member_price; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(member_price) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.member_program_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(member_program_id) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.is_bundle; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(is_bundle) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.extra; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(extra) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.price_record_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(price_record_id) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.decided_by; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(decided_by) ON TABLE public.capture_item TO authenticated;

--
-- Name: COLUMN capture_item.decided_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(decided_at) ON TABLE public.capture_item TO authenticated;

--
-- Name: TABLE category; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.category TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.category TO authenticated;

--
-- Name: TABLE household_member; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.household_member TO service_role;
GRANT SELECT ON TABLE public.household_member TO authenticated;

--
-- Name: TABLE household_program_membership; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.household_program_membership TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.household_program_membership TO authenticated;

--
-- Name: TABLE price_summary; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.price_summary TO service_role;
GRANT SELECT ON TABLE public.price_summary TO authenticated;

--
-- Name: TABLE processing_run; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.processing_run TO service_role;

--
-- Name: COLUMN processing_run.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.processing_run TO authenticated;

--
-- Name: COLUMN processing_run.capture_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(capture_id) ON TABLE public.processing_run TO authenticated;

--
-- Name: COLUMN processing_run.household_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(household_id) ON TABLE public.processing_run TO authenticated;

--
-- Name: COLUMN processing_run.status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(status) ON TABLE public.processing_run TO authenticated;

--
-- Name: COLUMN processing_run.error_message; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(error_message) ON TABLE public.processing_run TO authenticated;

--
-- Name: COLUMN processing_run.started_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(started_at) ON TABLE public.processing_run TO authenticated;

--
-- Name: COLUMN processing_run.finished_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(finished_at) ON TABLE public.processing_run TO authenticated;

--
-- Name: TABLE product_alias; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_alias TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_alias TO authenticated;

--
-- Name: TABLE product_group; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_group TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_group TO authenticated;

--
-- Name: TABLE profile; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profile TO service_role;
GRANT SELECT,UPDATE ON TABLE public.profile TO authenticated;

--
-- Name: TABLE public_price_fact; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.public_price_fact TO service_role;
GRANT SELECT ON TABLE public.public_price_fact TO authenticated;
GRANT SELECT ON TABLE public.public_price_fact TO anon;

--
-- Name: TABLE receipt; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.receipt TO service_role;

--
-- Name: COLUMN receipt.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id),INSERT(id) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.household_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(household_id),INSERT(household_id) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.capture_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(capture_id),INSERT(capture_id) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.store_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(store_id),INSERT(store_id),UPDATE(store_id) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.branch_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(branch_id),INSERT(branch_id),UPDATE(branch_id) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.transaction_date; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(transaction_date),INSERT(transaction_date),UPDATE(transaction_date) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.transaction_time; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(transaction_time),INSERT(transaction_time),UPDATE(transaction_time) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.currency; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(currency),INSERT(currency) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.subtotal_amount; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(subtotal_amount),INSERT(subtotal_amount),UPDATE(subtotal_amount) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.total_amount; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(total_amount),INSERT(total_amount),UPDATE(total_amount) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.payment_method; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(payment_method),INSERT(payment_method),UPDATE(payment_method) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(status),INSERT(status) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.duplicate_of_receipt_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(duplicate_of_receipt_id),INSERT(duplicate_of_receipt_id) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.confirmed_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(confirmed_at),INSERT(confirmed_at) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.receipt TO authenticated;

--
-- Name: COLUMN receipt.field_confidence; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(field_confidence),INSERT(field_confidence) ON TABLE public.receipt TO authenticated;

--
-- Name: TABLE receipt_adjustment; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.receipt_adjustment TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.receipt_adjustment TO authenticated;

--
-- Name: TABLE shopping_session; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shopping_session TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shopping_session TO authenticated;

--
-- Name: TABLE store_group; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.store_group TO service_role;
GRANT SELECT ON TABLE public.store_group TO authenticated;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;

--
-- PostgreSQL database dump complete
--


-- Data referensi
--
-- PostgreSQL database dump
--

--
-- Data for Name: config; Type: TABLE DATA; Schema: app; Owner: -
--

INSERT INTO app.config VALUES
	('best_price_window_days', '90', 'Jendela harga terbaik utama (D-02)'),
	('trend_window_days', '30', 'Panjang satu jendela tren; dibandingkan dengan jendela sebelumnya'),
	('trend_min_records_per_window', '2', 'Data minimal per jendela agar tren ditampilkan (D-15)'),
	('trend_flat_threshold_pct', '2', 'Perubahan di bawah persen ini dianggap stabil'),
	('alias_promotion_threshold', '3', 'Jumlah household berbeda untuk promosi alias (D-35)'),
	('image_retention_months', '12', 'Retensi gambar capture (D-32)'),
	('auto_save_min_confidence', '0.90', 'Ambang auto-save D-12. Nilai final setelah uji OCR (D-16, D-50)'),
	('near_best_threshold_pct', '5', 'Batas "mendekati harga terbaik" di Cek harga rak dan sesi (D-55)'),
	('capture_max_attempts', '3', 'Percobaan maksimum pemrosesan capture (§5.3)'),
	('capture_processing_timeout_seconds', '300', 'Lease run: lebih lama dari ini → reaper (§5.3)'),
	('capture_retry_backoff_seconds', '[30, 120, 600]', 'Backoff retry otomatis per percobaan (§5.3)'),
	('fuzzy_min_similarity', '0.5', 'Ambang matching tier 3 (word_similarity)'),
	('orphan_upload_ttl_hours', '24', 'Umur unggahan yatim sebelum disapu (§5.2)'),
	('ocr_redact_after_days', '7', 'Redaksi OCR mentah N hari setelah capture final (§7.4)'),
	('session_extend_hours', '2', 'Perpanjangan sesi belanja (D-60)'),
	('ask_daily_limit', '30', 'Tanya: pertanyaan maksimum per household per hari (zona household, D-92)'),
	('ask_monthly_limit', '300', 'Tanya: pertanyaan maksimum per household per bulan kalender (D-92)'),
	('ai_daily_budget_usd', '2.00', 'Anggaran biaya AI global per hari (US$, zona DB). Habis → worker berhenti claim, Tanya 429 (docs/08 §12.3)');

--
-- Data for Name: unit; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.unit VALUES
	('mg', 'miligram', 'mass', 0.001000),
	('g', 'gram', 'mass', 1.000000),
	('kg', 'kilogram', 'mass', 1000.000000),
	('ml', 'mililiter', 'volume', 1.000000),
	('l', 'liter', 'volume', 1000.000000),
	('pcs', 'pcs', 'count', 1.000000),
	('lembar', 'lembar', 'count', 1.000000),
	('cm', 'sentimeter', 'length', 0.010000),
	('m', 'meter', 'length', 1.000000);

--
-- PostgreSQL database dump complete
--

INSERT INTO public.category (slug, name) VALUES ('bayi', 'Bayi');
INSERT INTO public.category (slug, name) VALUES ('elektronik', 'Elektronik');
INSERT INTO public.category (slug, name) VALUES ('kesehatan', 'Kesehatan');
INSERT INTO public.category (slug, name) VALUES ('lainnya', 'Lainnya');
INSERT INTO public.category (slug, name) VALUES ('makanan', 'Makanan');
INSERT INTO public.category (slug, name) VALUES ('minuman', 'Minuman');
INSERT INTO public.category (slug, name) VALUES ('rumah-tangga', 'Rumah Tangga');
