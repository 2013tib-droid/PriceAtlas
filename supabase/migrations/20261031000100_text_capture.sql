-- =============================================================================
-- 0100 (2026-10-31) · Struk tempelan dari Gemini (D-100, docs/08 §23)
-- =============================================================================
-- Mode pemakaian pribadi tanpa anggaran AI: struk difoto di Gemini (di luar app), JSON jawabannya
-- ditempel di S-21 `/tempel`, lalu diproses worker TANPA AI (TextExtractor, format tetap) lewat
-- jalur yang sama dengan foto: antrean → matching tier 1–3 → konfirmasi S-10.
--   * capture.source ('image' | 'text') + capture.pasted_text (≤ 50.000 karakter). Capture teks tidak
--     punya capture_image. pasted_text dikosongkan 12 bulan setelah unggah (Q-150, sama dengan
--     gambar D-32) oleh enqueue_retention; sesudah itu capture tidak bisa diproses ulang.
--   * Trigger: source tidak bisa diubah, pasted_text hanya boleh dikosongkan (tabel capture punya
--     UPDATE untuk authenticated lewat RLS).
--   * W1b submit_text_capture: pola W1 (idempoten per id, sesi belanja), hanya jenis struk (Q-147).
--   * claim_next_capture: + p_sources (worker dengan EXTRACTOR=off hanya mengklaim teks),
--     engine/prompt run untuk capture teks, keluaran + source, pasted_text.
--   * R13 list_captures: + source.
-- Aditif: capture lama = 'image', perilaku foto tidak berubah.

alter table public.capture
  add column source text not null default 'image' check (source in ('image', 'text')),
  add column pasted_text text check (char_length(pasted_text) <= 50000),
  add constraint capture_pasted_text_only_text check (source = 'text' or pasted_text is null);

comment on column public.capture.source is
  'Asal capture (D-100): image = foto di bucket captures (capture_image), text = JSON tempelan dari Gemini (pasted_text).';
comment on column public.capture.pasted_text is
  'Teks tempelan apa adanya (D-100). Dikosongkan 12 bulan setelah unggah (Q-150); tidak pernah dicatat di log.';

create function app.capture_source_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source is distinct from old.source then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'source_immutable'));
  end if;
  if new.pasted_text is distinct from old.pasted_text and new.pasted_text is not null then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'pasted_text_immutable'));
  end if;
  return new;
end $$;

create trigger capture_source_guard before update of source, pasted_text on public.capture
  for each row execute function app.capture_source_guard();

-- -----------------------------------------------------------------------------
-- W1b submit_text_capture (S-21)
-- -----------------------------------------------------------------------------
create function public.submit_text_capture(
  p_capture_id uuid, p_kind text, p_text text,
  p_shopping_session_id uuid default null, p_store_id uuid default null, p_branch_id uuid default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_h      public.household;
  v_c      public.capture;
  v_store  uuid := p_store_id;
  v_branch uuid := p_branch_id;
begin
  -- 1. Idempoten (D-59).
  select * into v_c from public.capture where id = p_capture_id;
  if v_c.id is not null then
    return jsonb_build_object('capture_id', v_c.id, 'status', v_c.status, 'created', false);
  end if;

  v_h := app.require_household();
  if p_kind is distinct from 'receipt' then                         -- Q-147: struk dulu
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'kind'));
  end if;
  if p_text is null or btrim(p_text) = '' then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'text_required'));
  end if;
  if char_length(p_text) > 50000 then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'text_too_long'));
  end if;

  -- 2. Sesi (sama dengan W1).
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

  insert into public.capture (id, household_id, kind, status, shopping_session_id, store_id, branch_id,
                              uploaded_by, source, pasted_text)
  values (p_capture_id, v_h.id, p_kind, 'uploaded', p_shopping_session_id, v_store, v_branch,
          (select auth.uid()), 'text', p_text)
  returning * into v_c;

  perform pg_notify('capture_uploaded', p_capture_id::text);
  return jsonb_build_object('capture_id', v_c.id, 'status', v_c.status, 'created', true);
end $$;

-- -----------------------------------------------------------------------------
-- claim_next_capture: sumber yang diklaim + engine run per sumber
-- -----------------------------------------------------------------------------
drop function app.claim_next_capture(text, text, text, text);

create function app.claim_next_capture(p_worker text, p_engine text default null, p_model text default null,
                                       p_prompt_version text default null, p_sources text[] default null,
                                       p_text_engine text default null, p_text_prompt_version text default null)
returns table (capture_id uuid, run_id uuid, kind text, household_id uuid, attempt integer,
               store_id uuid, branch_id uuid, shopping_session_id uuid, uploaded_at timestamptz,
               captured_at timestamptz, images jsonb, source text, pasted_text text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_backoff jsonb := app.config_json('capture_retry_backoff_seconds');
  v_c       public.capture;
  v_round   record;
  v_run     uuid;
  v_text    boolean;
begin
  select c.* into v_c
    from public.capture c
    cross join lateral app.capture_round_runs(c.id) rr
   where c.status = 'uploaded'
     and (p_sources is null or c.source = any (p_sources))
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
  v_text := v_c.source = 'text';

  update public.capture set status = 'processing', error_message = null, error_code = null where id = v_c.id;
  insert into public.processing_run (capture_id, household_id, status, ocr_engine, ai_model, prompt_version)
  values (v_c.id, v_c.household_id, 'running',
          case when v_text then coalesce(p_text_engine, p_engine) else p_engine end,
          case when v_text and p_text_engine is not null then null else p_model end,
          case when v_text then coalesce(p_text_prompt_version, p_prompt_version, p_worker)
               else coalesce(p_prompt_version, p_worker) end)
  returning id into v_run;

  capture_id := v_c.id; run_id := v_run; kind := v_c.kind; household_id := v_c.household_id;
  attempt := v_round.n + 1; store_id := v_c.store_id; branch_id := v_c.branch_id;
  shopping_session_id := v_c.shopping_session_id; uploaded_at := v_c.uploaded_at; captured_at := v_c.captured_at;
  source := v_c.source; pasted_text := v_c.pasted_text;
  select coalesce(jsonb_agg(jsonb_build_object('position', i.position, 'storage_path', i.storage_path,
                                               'sha256', i.sha256, 'byte_size', i.byte_size) order by i.position), '[]')
    into images from public.capture_image i where i.capture_id = v_c.id;
  return next;
end $$;

-- -----------------------------------------------------------------------------
-- R13 list_captures: + source (S-08 ikon teks)
-- -----------------------------------------------------------------------------
create or replace function public.list_captures(p_limit integer default 30, p_before timestamptz default null,
                                                p_kind text default null) returns setof jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'status', c.status, 'source', c.source,
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

-- -----------------------------------------------------------------------------
-- Retensi: + teks tempelan 12 bulan setelah unggah (Q-150). Langsung di SQL (tanpa Storage).
-- -----------------------------------------------------------------------------
create or replace function app.enqueue_retention() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_img  integer := 0;
  v_ocr  integer := 0;
  v_hh   integer := 0;
  v_txt  integer := 0;
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

  -- Teks tempelan jatuh tempo (D-100, Q-150): sama dengan umur gambar (D-32).
  update public.capture c set pasted_text = null
   where c.source = 'text' and c.pasted_text is not null
     and c.uploaded_at < now() - interval '12 months';
  get diagnostics v_txt = row_count;

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

  return jsonb_build_object('purge_images', v_img, 'redact_ocr', v_ocr, 'delete_household', v_hh, 'purge_text', v_txt);
end $$;

-- -----------------------------------------------------------------------------
-- Hak akses (F-09)
-- -----------------------------------------------------------------------------
revoke all on function app.capture_source_guard() from public, anon, authenticated;
grant execute on function app.capture_source_guard() to service_role;
revoke all on function public.submit_text_capture(uuid, text, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_text_capture(uuid, text, text, uuid, uuid, uuid) to authenticated, service_role;
revoke all on function app.claim_next_capture(text, text, text, text, text[], text, text) from public, anon, authenticated;
grant execute on function app.claim_next_capture(text, text, text, text, text[], text, text) to service_role;
