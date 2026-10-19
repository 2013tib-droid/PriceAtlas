-- =============================================================================
-- 0310 · RPC tulis W1–W18 dan alur §4 (docs/05 §3.2, §3.3, §4, §5.2)
-- =============================================================================
-- Prinsip (§4): satu RPC = satu transaksi; idempoten berdasarkan keadaan (baris
-- dikunci FOR UPDATE, pekerjaan yang sudah selesai dikembalikan apa adanya).
-- Default SECURITY INVOKER (RLS berlaku). DEFINER hanya W14/W15 (cek owner) dan
-- helper app.* kecil yang menyentuh kolom/tabel yang tidak boleh ditulis user;
-- helper itu selalu memeriksa household pemanggil secara eksplisit.
-- Transisi status capture/item oleh RPC ditandai dengan app.via_rpc (lihat 0120, 0220).

-- -----------------------------------------------------------------------------
-- Helper
-- -----------------------------------------------------------------------------

-- Household pemanggil atau FORBIDDEN.
create function app.require_household() returns public.household
language plpgsql stable
set search_path = ''
as $$
declare
  v_h public.household := app.my_household();
begin
  if v_h.id is null then
    perform app.err('FORBIDDEN', jsonb_build_object('reason', 'no_household'));
  end if;
  return v_h;
end $$;

-- Tandai transaksi ini sebagai jalur RPC (penjaga capture_status_guard dan capture_item_guard).
create function app.mark_rpc() returns void
language sql volatile
set search_path = ''
as $$ select set_config('app.via_rpc', 'on', true); $$;

-- Pastikan patch hanya memuat kunci yang diizinkan.
create function app.check_patch_keys(p_patch jsonb, p_allowed text[]) returns void
language plpgsql immutable
set search_path = ''
as $$
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

-- Status dan penanda duplikat struk (kolom yang tidak bisa di-update user langsung).
create function app.set_receipt_state(p_receipt_id uuid, p_status text, p_duplicate_of uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
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

-- Alias household (§5.9, D-35): keputusan user menjadi alias untuk household itu.
-- Alias household menang atas alias global; konflik dialihkan ke produk terbaru.
create function app.upsert_household_alias(p_household uuid, p_store_id uuid, p_product_id uuid, p_text text)
returns uuid
language plpgsql
set search_path = ''
as $$
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

-- Antrekan penghapusan file Storage untuk household pemanggil (F-14: user tidak bisa
-- menghapus objek sendiri; job purge_storage_paths dikerjakan worker).
create function app.enqueue_storage_purge(p_household uuid, p_paths text[]) returns bigint
language plpgsql security definer
set search_path = ''
as $$
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

-- Path yang belum ada di bucket captures (hanya folder household pemanggil).
create function app.missing_storage_paths(p_household uuid, p_paths text[]) returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(p order by p), '{}')
    from unnest(p_paths) p
   where split_part(p, '/', 1) <> p_household::text
      or ((select auth.uid()) is not null and p_household not in (select app.my_household_ids()))
      or not exists (select 1 from storage.objects o where o.bucket_id = 'captures' and o.name = p)
$$;

-- Item capture sebagai JSON R16 (dipakai W18).
create function app.capture_item_json(p_item_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select x from public.capture_item i
   cross join lateral public.get_capture_items(i.capture_id) x
   where i.id = p_item_id and (x ->> 'id')::uuid = p_item_id
$$;

-- -----------------------------------------------------------------------------
-- W1 submit_capture · W2 retry_capture · W3 delete_capture (§5.2, §5.4)
-- -----------------------------------------------------------------------------
create function public.submit_capture(
  p_capture_id uuid, p_kind text, p_images jsonb,
  p_shopping_session_id uuid default null, p_store_id uuid default null, p_branch_id uuid default null,
  p_captured_at timestamptz default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
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
end $$;

create function public.retry_capture(p_capture_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
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

create function public.delete_capture(p_capture_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- W4 confirm_receipt (§4.1)
-- -----------------------------------------------------------------------------
create function public.confirm_receipt(p_receipt_id uuid, p_lines jsonb,
                                       p_duplicate_decision text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- Simpan satu item observasi menjadi price_record (§4.2 langkah 4–8, §5.5).
-- Dipakai W5 (outcome confirmed/corrected, dengan alias) dan worker (auto, tanpa alias).
-- -----------------------------------------------------------------------------
create function app.accept_capture_item(p_item_id uuid, p_product_id uuid, p_outcome text,
                                        p_create_alias boolean)
returns uuid
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- W5 confirm_capture_items (§4.2)
-- -----------------------------------------------------------------------------
create function public.confirm_capture_items(p_capture_id uuid, p_items jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- W18 update_capture_item (§4.2): hanya item pending, konkurensi optimistik
-- -----------------------------------------------------------------------------
create function public.update_capture_item(p_item_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_i public.capture_item;
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

  return app.capture_item_json(v_i.id);
end $$;

-- -----------------------------------------------------------------------------
-- W6 correct_price_record (§4.3)
-- -----------------------------------------------------------------------------
create function public.correct_price_record(p_id uuid, p_patch jsonb, p_expected_updated_at timestamptz,
                                            p_update_alias boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- W7 correct_receipt_line (§4.3)
-- -----------------------------------------------------------------------------
create function public.correct_receipt_line(p_line_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- W8 create_private_product (S-15): brand → group → produk → barcode, satu transaksi
-- -----------------------------------------------------------------------------
create function public.create_private_product(p_product jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- W9 move_price_records (§4.5, D-37)
-- -----------------------------------------------------------------------------
create function public.move_price_records(p_record_ids uuid[], p_target_product_id uuid,
                                          p_alias jsonb default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- W11–W13 sesi belanja (S-12, S-13, F-16, D-43, D-60)
-- -----------------------------------------------------------------------------
create function public.start_shopping_session(p_session_id uuid, p_branch_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
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

create function public.extend_shopping_session(p_session_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
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

create function public.end_shopping_session(p_session_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- W14 set_share_prices_public · W15 share_existing_prices (§4.6, D-51) — DEFINER
-- -----------------------------------------------------------------------------
create function app.require_owner() returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
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

create function public.set_share_prices_public(p_enabled boolean) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
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

create function public.share_existing_prices() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
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

-- Satu batch "Bagikan juga data lama" (dipanggil app.run_sql_jobs). FOR SHARE pada
-- household membuat batch menunggu opt-out yang sedang berjalan, lalu membaca false.
-- Hasil: jumlah record yang dibagikan; -1 jika opt-in sudah mati (job dibatalkan).
create function app.share_existing_batch(p_household uuid, p_limit integer default 1000) returns integer
language plpgsql security definer
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- W16 set_program_membership (S-19b) · W17 toko/cabang privat (S-12, D-29)
-- -----------------------------------------------------------------------------
create function public.set_program_membership(p_program_id uuid, p_member boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
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

create function public.create_private_store(p_store jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
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

create function public.create_private_branch(p_branch jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- Hak akses (F-09)
-- -----------------------------------------------------------------------------
-- W18 mengubah match_tier menjadi 'manual' saat produk diganti user.
grant update (match_tier) on public.capture_item to authenticated;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('require_household', 'mark_rpc', 'check_patch_keys', 'set_receipt_state',
                                'upsert_household_alias', 'enqueue_storage_purge', 'missing_storage_paths',
                                'capture_item_json', 'accept_capture_item', 'require_owner',
                                'share_existing_batch') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if f::text not like 'app.share_existing_batch%' then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    execute format('grant execute on function %s to service_role', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('submit_capture', 'retry_capture', 'delete_capture', 'confirm_receipt',
                                'confirm_capture_items', 'update_capture_item', 'correct_price_record',
                                'correct_receipt_line', 'create_private_product', 'move_price_records',
                                'start_shopping_session', 'extend_shopping_session', 'end_shopping_session',
                                'set_share_prices_public', 'share_existing_prices', 'set_program_membership',
                                'create_private_store', 'create_private_branch') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
