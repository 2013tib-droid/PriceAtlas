-- =============================================================================
-- 0320 · Fungsi app.* untuk worker, job SQL, retensi, hapus akun (docs/05 §5, §7.4–§7.6)
-- =============================================================================
-- Semua fungsi DEFINER dan hanya bisa dijalankan service_role (worker, pg_cron,
-- Route Handler). Household SELALU diturunkan dari capture/job, tidak pernah dari
-- output AI (§7.1). FK komposit dan enforce_ref_visibility tetap berlaku.

-- -----------------------------------------------------------------------------
-- Job generik (app.job): klaim dengan lease, selesai, ulang, gagal
-- -----------------------------------------------------------------------------
-- Lease: run_after dipakai sebagai batas lease selama status 'running'.
create function app.claim_job(p_kinds text[], p_lease_seconds integer default 300) returns setof app.job
language plpgsql security definer
set search_path = ''
as $$
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

create function app.complete_job(p_job_id bigint, p_note text default null) returns void
language sql security definer
set search_path = ''
as $$
  update app.job set status = 'done', finished_at = now(), last_error = p_note
   where id = p_job_id and status = 'running'
$$;

-- Kembalikan ke antrean (lanjut batch berikutnya, atau backoff setelah error).
create function app.requeue_job(p_job_id bigint, p_delay_seconds integer default 0, p_error text default null,
                                p_payload jsonb default null)
returns void
language sql security definer
set search_path = ''
as $$
  update app.job
     set status = 'pending', run_after = now() + make_interval(secs => p_delay_seconds),
         last_error = coalesce(p_error, last_error), payload = coalesce(p_payload, payload)
   where id = p_job_id and status = 'running'
$$;

create function app.fail_job(p_job_id bigint, p_error text) returns void
language sql security definer
set search_path = ''
as $$
  update app.job set status = 'failed', finished_at = now(), last_error = p_error
   where id = p_job_id and status = 'running'
$$;

-- Job SQL (§1.4): recompute_unit_price dan share_existing_prices, satu batch per klaim.
create function app.run_sql_jobs(p_limit integer default 50) returns integer
language plpgsql security definer
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- Pipeline capture: klaim, lease, retry, reaper (§5.3)
-- -----------------------------------------------------------------------------
-- Satu "putaran" percobaan dimulai setelah capture.processed_at terakhir (diisi saat
-- capture selesai atau gagal final), sehingga retry_capture oleh user memulai
-- putaran baru tanpa kolom tambahan.
create function app.capture_round_runs(p_capture_id uuid)
returns table (n integer, last_finished timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select count(*)::integer, max(r.finished_at)
    from public.processing_run r
    join public.capture c on c.id = r.capture_id
   where r.capture_id = p_capture_id
     and r.started_at > coalesce(c.processed_at, '-infinity'::timestamptz)
$$;

create function app.claim_next_capture(p_worker text, p_engine text default null, p_model text default null,
                                       p_prompt_version text default null)
returns table (capture_id uuid, run_id uuid, kind text, household_id uuid, attempt integer,
               store_id uuid, branch_id uuid, shopping_session_id uuid, uploaded_at timestamptz,
               captured_at timestamptz, images jsonb)
language plpgsql security definer
set search_path = ''
as $$
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

-- Data mentah selalu disimpan (§3 PROJECT.md, T-a).
create function app.record_run_output(p_run_id uuid, p_raw_text text, p_raw_output jsonb,
                                      p_input_tokens integer default null, p_output_tokens integer default null,
                                      p_cost_usd numeric default null)
returns boolean
language sql security definer
set search_path = ''
as $$
  with u as (
    update public.processing_run
       set raw_ocr_text = p_raw_text, raw_ai_output = p_raw_output,
           input_tokens = p_input_tokens, output_tokens = p_output_tokens, cost_usd = p_cost_usd
     where id = p_run_id and status = 'running'
    returning 1)
  select exists (select 1 from u)
$$;

-- Run gagal. Transient + sisa percobaan → kembali 'uploaded' (retry otomatis dengan
-- backoff). Permanen atau percobaan habis → 'failed' + error_code (X-08).
-- Hasil: status capture baru, atau 'stale' jika run ini bukan run aktif terakhir.
create function app.fail_run(p_run_id uuid, p_error_code text, p_message text, p_transient boolean)
returns text
language plpgsql security definer
set search_path = ''
as $$
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

-- Reaper (pg_cron tiap menit): run 'running' melewati lease → gagal transient
-- "timeout". Sekalian: job 'running' yang lease-nya habis kembali ke antrean.
create function app.reap_stale_runs() returns integer
language plpgsql security definer
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- Resolusi toko dan matching tier 1–3 (§5.4, §5.5 langkah 1)
-- -----------------------------------------------------------------------------
-- Nama toko terbaca → toko global atau milik household (nama ternormalisasi).
-- Cabang hanya jika cocok dengan toko itu.
create function app.resolve_store(p_household uuid, p_store_name text, p_branch_name text default null)
returns table (store_id uuid, branch_id uuid)
language plpgsql stable security definer
set search_path = ''
as $$
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

-- Lokasi capture (§5.5): struk → pilihan manual capture → nama terbaca;
-- label/screenshot → sesi → pilihan manual capture → store_hint. Dipakai worker
-- (toko untuk matching alias) dan apply_extraction, sehingga keduanya selalu sama.
create function app.capture_location(p_capture_id uuid, p_store_name text, p_branch_name text default null)
returns table (store_id uuid, branch_id uuid)
language plpgsql stable security definer
set search_path = ''
as $$
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

-- Matching deterministik (D-13, D-35, F-01). Masukan: [{key, raw_text, barcode?, date?}].
-- Keluaran: [{key, product_id, tier, confidence, candidates: [{product_id, tier, confidence}]}].
-- Confidence per tier adalah placeholder sampai uji OCR (D-16, D-70, Q-21).
create function app.match_products(p_household uuid, p_store_id uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- app.apply_extraction (§5.5): satu transaksi, aturan auto-save
-- -----------------------------------------------------------------------------
-- Payload (dibentuk worker dari Extraction + hasil matching, kontrak di
-- packages/contracts ApplyPayload). Hasil: {status, receipt_id?, items?, auto_saved}.
create function app.apply_extraction(p_capture_id uuid, p_run_id uuid, p_payload jsonb) returns jsonb
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
        select mp.id into v_prog from public.member_program mp
         where mp.store_id = v_store
           and (app.normalize_text(mp.name) = app.normalize_text(v_item ->> 'member_program_name')
                or (v_item ->> 'member_program_name' is null
                    and (select count(*) from public.member_program x where x.store_id = v_store and x.status = 'active') = 1
                    and mp.status = 'active'))
         limit 1;
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
        member_price, member_program_id, is_bundle, extra, field_confidence)
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
                   where e.key in ('product', 'price', 'date', 'store') and jsonb_typeof(e.value) = 'number'), '{}'))
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
-- Retensi (§7.4, §7.5, D-32, Q-14) dan unggahan yatim (§5.2)
-- -----------------------------------------------------------------------------
create function app.enqueue_retention() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
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

create function app.images_to_purge(p_image_ids uuid[]) returns table (id uuid, storage_path text)
language sql stable security definer
set search_path = ''
as $$
  select ci.id, ci.storage_path from public.capture_image ci
   where ci.id = any (p_image_ids) and ci.purged_at is null
   order by ci.storage_path
$$;

-- Tandai gambar terhapus. receipt.pii dikosongkan bersamaan (Q-14, D-64) jika
-- semua gambar capture-nya sudah dihapus. Baris dan sha256 tetap (deteksi duplikat).
create function app.mark_images_purged(p_image_ids uuid[]) returns integer
language plpgsql security definer
set search_path = ''
as $$
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

create function app.runs_to_redact(p_run_ids uuid[])
returns table (run_id uuid, raw_ocr_text text, raw_ai_output jsonb, pii jsonb)
language sql stable security definer
set search_path = ''
as $$
  select r.id, r.raw_ocr_text, r.raw_ai_output, coalesce(rc.pii, '{}')
    from public.processing_run r
    left join public.receipt rc on rc.capture_id = r.capture_id
   where r.id = any (p_run_ids) and r.pii_redacted_at is null
$$;

create function app.apply_redaction(p_run_id uuid, p_raw_ocr_text text, p_raw_ai_output jsonb) returns boolean
language sql security definer
set search_path = ''
as $$
  with u as (
    update public.processing_run
       set raw_ocr_text = p_raw_ocr_text, raw_ai_output = p_raw_ai_output, pii_redacted_at = now()
     where id = p_run_id and pii_redacted_at is null
    returning 1)
  select exists (select 1 from u)
$$;

-- Objek di bucket captures tanpa baris capture_image, lebih tua dari TTL (§5.2).
create function app.orphan_storage_objects(p_limit integer default 500) returns table (name text)
language sql stable security definer
set search_path = ''
as $$
  select o.name from storage.objects o
   where o.bucket_id = 'captures'
     and o.created_at < now() - make_interval(hours => app.config_numeric('orphan_upload_ttl_hours')::integer)
     and not exists (select 1 from public.capture_image ci where ci.storage_path = o.name)
   order by o.created_at
   limit p_limit
$$;

-- -----------------------------------------------------------------------------
-- Hapus akun (§7.6, BR-8, D-65)
-- -----------------------------------------------------------------------------
create function app.begin_account_deletion(p_user_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
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

-- Pembungkus untuk Route Handler (supabase-js service role hanya memanggil RPC public).
-- Tidak bisa dijalankan anon/authenticated.
create function public.begin_account_deletion(p_user_id uuid) returns jsonb
language sql security definer
set search_path = ''
as $$ select app.begin_account_deletion(p_user_id) $$;

-- Langkah 1–2 job delete_household: tunggu tanpa anggota, lalu lepas tautan fakta publik.
create function app.prepare_household_deletion(p_household uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
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

-- Langkah 4: cascade seluruh data household (record, struk, capture, ringkasan, audit, katalog privat).
create function app.finish_household_deletion(p_household uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
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

-- -----------------------------------------------------------------------------
-- Hak akses: hanya service_role (F-09)
-- -----------------------------------------------------------------------------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('claim_job', 'complete_job', 'requeue_job', 'fail_job', 'run_sql_jobs',
                                'capture_round_runs', 'claim_next_capture', 'record_run_output', 'fail_run',
                                'reap_stale_runs', 'resolve_store', 'capture_location', 'match_products', 'apply_extraction',
                                'enqueue_retention', 'images_to_purge', 'mark_images_purged', 'runs_to_redact',
                                'apply_redaction', 'orphan_storage_objects', 'begin_account_deletion',
                                'prepare_household_deletion', 'finish_household_deletion') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.begin_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.begin_account_deletion(uuid) to service_role;
grant execute on all functions in schema app to service_role;
