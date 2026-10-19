-- 70 · Pipeline capture (§5): submit, penjaga status, claim SKIP LOCKED, reaper, backoff,
--      percobaan maks, matching tier 1–3, apply_extraction + aturan auto-save (D-50, D-71),
--      retensi gambar / redaksi OCR / unggahan yatim.
\ir ../lib/harness.sql
\ir ../lib/seed.sql
create extension if not exists dblink with schema test;

create function test.upload(p_user text, p_capture uuid, p_pos int default 1) returns text
language plpgsql as $$
declare v_name text := test.hh(p_user) || '/' || p_capture || '/' || p_pos || '.jpg';
begin
  insert into storage.objects (bucket_id, name, owner) values ('captures', v_name, test.uid(p_user));
  return v_name;
end $$;
create function test.img(p_pos int, p_sha text) returns jsonb language sql immutable as
$$ select jsonb_build_object('position', p_pos, 'ext', 'jpg', 'sha256', p_sha, 'byte_size', 1000) $$;
grant execute on all functions in schema test to authenticated;

-- ---------------------------------------------------------------------------
-- W1 submit_capture
-- ---------------------------------------------------------------------------
select test.login(test.uid('a'));
select test.expect_code($$select public.submit_capture('ca000000-0000-0000-0000-000000000001', 'receipt',
                          jsonb_build_array(test.img(1, repeat('1', 64))))$$,
                        'CAPTURE_IMAGES_MISSING', '§5.2: file belum ada di Storage → error');
select test.upload('a', 'ca000000-0000-0000-0000-000000000001');
select test.expect_code($$select public.submit_capture('ca000000-0000-0000-0000-000000000001', 'receipt',
                          jsonb_build_array(test.img(1, 'XYZ')))$$,
                        'INVALID_INPUT', 'sha256 tidak valid ditolak');
select test.ok((select r ->> 'created' = 'true' and r ->> 'status' = 'uploaded'
                  from public.submit_capture('ca000000-0000-0000-0000-000000000001', 'receipt',
                                             jsonb_build_array(test.img(1, repeat('1', 64)))) r),
               'W1: capture terdaftar');
select test.ok((select r ->> 'created' = 'false'
                  from public.submit_capture('ca000000-0000-0000-0000-000000000001', 'receipt',
                                             jsonb_build_array(test.img(1, repeat('1', 64)))) r)
               and (select count(*) = 1 from public.capture_image where capture_id = 'ca000000-0000-0000-0000-000000000001'),
               'W1: idempoten (D-59)');
select test.ok((select storage_path = test.hh('a') || '/ca000000-0000-0000-0000-000000000001/1.jpg'
                  from public.capture_image where capture_id = 'ca000000-0000-0000-0000-000000000001'),
               'W1: path dibangun server');
-- Sesi kedaluwarsa tetap diterima; lokasi diisi dari cabang sesi.
insert into public.shopping_session (id, household_id, branch_id, started_at, expires_at)
values ('5e000000-0000-0000-0000-000000000001', test.hh('a'), '30000000-0000-0000-0000-000000000001',
        now() - interval '6 hours', now() - interval '2 hours');
select test.upload('a', 'ca000000-0000-0000-0000-000000000002');
select public.submit_capture('ca000000-0000-0000-0000-000000000002', 'price_label',
                             jsonb_build_array(test.img(1, repeat('2', 64))), '5e000000-0000-0000-0000-000000000001',
                             p_captured_at => now() - interval '1 day');
select test.ok((select store_id = '20000000-0000-0000-0000-000000000001' and branch_id = '30000000-0000-0000-0000-000000000001'
                       and captured_at < now() - interval '23 hours'
                  from public.capture where id = 'ca000000-0000-0000-0000-000000000002'),
               'W1: sesi kedaluwarsa diterima (D-59), lokasi dari sesi, captured_at (Q-27)');
select test.logout();

-- ---------------------------------------------------------------------------
-- Klaim: FIFO, SKIP LOCKED (dua sesi), status processing, run running
-- ---------------------------------------------------------------------------
select test.dblink_connect('w2', 'dbname=' || current_database() || ' user=postgres');
select test.dblink_exec('w2', 'begin');
select * from test.dblink('w2', $$select capture_id::text from app.claim_next_capture('worker-2')$$) as t(c text);
create temp table claim1 as select * from app.claim_next_capture('worker-1', 'stub', null, 'stub-v1');
select test.ok((select capture_id = 'ca000000-0000-0000-0000-000000000002' and attempt = 1 and kind = 'price_label'
                       and jsonb_array_length(images) = 1 from claim1),
               '§5.3: SKIP LOCKED — worker kedua mengambil capture lain');
select test.dblink_exec('w2', 'rollback');
select test.dblink_disconnect('w2');
select test.ok((select status = 'processing' from public.capture where id = 'ca000000-0000-0000-0000-000000000002')
               and (select status = 'running' and ocr_engine = 'stub' and prompt_version = 'stub-v1'
                      from public.processing_run where id = (select run_id from claim1)),
               'klaim: capture processing, run running dengan engine/prompt');
select test.login(test.uid('a'));
select test.expect_code($$select public.retry_capture('ca000000-0000-0000-0000-000000000002')$$,
                        'INVALID_TRANSITION', 'W2: retry hanya dari failed (bukan processing)');
select test.expect_code($$select public.delete_capture('ca000000-0000-0000-0000-000000000002')$$,
                        'INVALID_STATE', 'W3: capture processing tidak bisa dihapus');
select test.logout();
create temp table claim2 as select * from app.claim_next_capture('worker-1');
select test.ok((select capture_id = 'ca000000-0000-0000-0000-000000000001' from claim2), 'klaim kedua: capture tertua yang tersisa');
select test.ok(not exists (select 1 from app.claim_next_capture('worker-1')), 'antrean kosong');

-- ---------------------------------------------------------------------------
-- Gagal, backoff, percobaan maks, permanen, reaper, worker basi
-- ---------------------------------------------------------------------------
select test.ok(app.fail_run((select run_id from claim2), 'other', 'Server OCR 503', true) = 'uploaded',
               '§5.3: gagal transient → kembali uploaded');
select test.ok(not exists (select 1 from app.claim_next_capture('w')), 'backoff 30 detik: belum bisa diklaim');
update public.processing_run set finished_at = now() - interval '31 seconds' where id = (select run_id from claim2);
create temp table claim3 as select * from app.claim_next_capture('w');
select test.ok((select attempt = 2 from claim3), 'setelah backoff: percobaan ke-2');
select app.fail_run((select run_id from claim3), 'other', 'x', true);
update public.processing_run set finished_at = now() - interval '119 seconds' where id = (select run_id from claim3);
select test.ok(not exists (select 1 from app.claim_next_capture('w')), 'backoff ke-2 = 120 detik');
update public.processing_run set finished_at = now() - interval '121 seconds' where id = (select run_id from claim3);
update public.processing_run set finished_at = now() - interval '200 seconds' where id = (select run_id from claim2);
create temp table claim4 as select * from app.claim_next_capture('w');
select test.ok((select attempt = 3 from claim4), 'percobaan ke-3');
select test.ok(app.fail_run((select run_id from claim4), 'other', 'Server OCR 503', true) = 'failed',
               'percobaan maks (3) → failed');
select test.ok((select status = 'failed' and error_code = 'other' and processed_at is not null
                  from public.capture where id = 'ca000000-0000-0000-0000-000000000001'),
               'X-08: capture failed dengan error_code');
select test.ok(app.fail_run((select run_id from claim4), 'other', 'x', true) = 'stale', 'fail_run kedua untuk run yang sama → stale');

-- Retry user → putaran baru
select test.login(test.uid('a'));
select public.retry_capture('ca000000-0000-0000-0000-000000000001');
select test.ok((select status = 'uploaded' and error_code is null from public.capture where id = 'ca000000-0000-0000-0000-000000000001'),
               'W2: retry_capture failed → uploaded');
select test.ok((select public.retry_capture('ca000000-0000-0000-0000-000000000001') ->> 'status' = 'uploaded'), 'W2: idempoten');
select test.logout();
create temp table claim5 as select * from app.claim_next_capture('w');
select test.ok((select attempt = 1 from claim5), 'retry user memulai putaran baru (percobaan 1, tanpa backoff)');

-- Permanen
select test.ok(app.fail_run((select run_id from claim5), 'not_a_receipt', 'Gambar ini bukan struk.', false) = 'failed',
               'gagal permanen → langsung failed');
select test.ok((select error_code = 'not_a_receipt' and error_message = 'Gambar ini bukan struk.'
                  from public.capture where id = 'ca000000-0000-0000-0000-000000000001'),
               'error_message berbahasa Indonesia untuk UI');

-- Reaper + worker basi
update public.processing_run set started_at = now() - interval '301 seconds' where id = (select run_id from claim1);
select test.ok(app.reap_stale_runs() = 1, '§5.3: reaper menandai run macet');
select test.ok((select status = 'failed' and error_message like 'Waktu%' from public.processing_run where id = (select run_id from claim1))
               and (select status = 'uploaded' from public.capture where id = 'ca000000-0000-0000-0000-000000000002'),
               'reaper: run failed (timeout), capture kembali uploaded');
select test.ok((app.apply_extraction('ca000000-0000-0000-0000-000000000002', (select run_id from claim1), '{"items": []}') ->> 'status') = 'stale',
               '§5.3: hasil worker basi dibuang');
select test.ok(not app.record_run_output((select run_id from claim1), 'teks', '{}'), 'record_run_output run basi diabaikan');

-- ---------------------------------------------------------------------------
-- Matching tier 1–3 (§5.4)
-- ---------------------------------------------------------------------------
insert into public.product (id, household_id, name, content_size, content_unit)
values ('7a000000-0000-0000-0000-000000000001', test.hh('a'), 'Susu Kedelai Ani', 1, 'l');
insert into public.barcode_assignment (product_id, code, code_type) values ('7a000000-0000-0000-0000-000000000001', '11112222', 'gtin');
select public.merge_product('7a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000180');
insert into public.product_alias (household_id, store_id, product_id, alias_text) values
  (test.hh('a'), '20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000200', 'INDOMIE GRG 85G');   -- household menang
insert into public.product_alias (store_id, product_id, alias_text, promoted_at) values
  ('20000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000500', 'MILO BESAR', now());              -- alias Alfamidi

create temp table m as
select x from jsonb_array_elements(app.match_products(test.hh('a'), '20000000-0000-0000-0000-000000000002', '[
  {"key": 1, "raw_text": "apa saja", "barcode": "8992696404441"},
  {"key": 2, "raw_text": "JERUK", "barcode": "2001"},
  {"key": 3, "raw_text": "SUSU", "barcode": "11112222"},
  {"key": 4, "raw_text": "INDOMIE GRG 85G"},
  {"key": 5, "raw_text": "MILO BESAR"},
  {"key": 6, "raw_text": "milo original 500"},
  {"key": 7, "raw_text": "zzzz qqqq"}]')) x;
select test.ok((select x ->> 'product_id' = '70000000-0000-0000-0000-000000000500' and x ->> 'tier' = 'barcode'
                       and (x ->> 'confidence')::numeric = 1 from m where x ->> 'key' = '1'), 'tier 1: GTIN global');
select test.ok((select x ->> 'product_id' = '70000000-0000-0000-0000-0000000000f1' and x ->> 'tier' = 'barcode'
                  from m where x ->> 'key' = '2'), 'tier 1: PLU di toko yang sama');
select test.ok((select x ->> 'product_id' = '70000000-0000-0000-0000-000000000180' from m where x ->> 'key' = '3'),
               'F-01: barcode privat produk merged mengikuti merged_into_id');
select test.ok((select x ->> 'product_id' = '70000000-0000-0000-0000-000000000200' and x ->> 'tier' = 'alias'
                       and (x ->> 'confidence')::numeric = 0.98 from m where x ->> 'key' = '4'),
               'tier 2: alias household menang atas alias global (D-35)');
select test.ok((select x ->> 'product_id' = '70000000-0000-0000-0000-000000000500' and (x ->> 'confidence')::numeric = 0.70
                  from m where x ->> 'key' = '5'), 'tier 2b: alias store_group hanya kandidat (≤ 0,70)');
select test.ok((select x ->> 'tier' = 'fuzzy' and x ->> 'product_id' = '70000000-0000-0000-0000-000000000500'
                       and jsonb_array_length(x -> 'candidates') between 2 and 5 from m where x ->> 'key' = '6'),
               'tier 3: fuzzy word_similarity + kandidat (maks 5)');
select test.ok((select x -> 'product_id' = 'null' and x -> 'candidates' = '[]' from m where x ->> 'key' = '7'),
               'tanpa kandidat → tier 4 (AI) yang menentukan');
select test.ok((select jsonb_array_length(app.match_products(test.hh('b'), '20000000-0000-0000-0000-000000000002',
                  '[{"key": 1, "raw_text": "susu kedelai ani"}]') #> '{0,candidates}') = 0
                or not exists (select 1 from jsonb_array_elements(app.match_products(test.hh('b'), '20000000-0000-0000-0000-000000000002',
                  '[{"key": 1, "raw_text": "susu kedelai ani"}]') #> '{0,candidates}') c
                   where c ->> 'product_id' = '7a000000-0000-0000-0000-000000000001')),
               '§7.1: matching household B tidak memakai produk privat A');

-- ---------------------------------------------------------------------------
-- apply_extraction: struk (§5.5)
-- ---------------------------------------------------------------------------
create function test.new_capture(p_id uuid, p_kind text, p_sha text, p_session uuid default null) returns uuid
language plpgsql as $$
declare v_run uuid;
begin
  insert into public.capture (id, household_id, kind, shopping_session_id) values (p_id, test.hh('a'), p_kind, p_session);
  insert into public.capture_image (capture_id, household_id, position, storage_path, sha256)
  values (p_id, test.hh('a'), 1, test.hh('a') || '/' || p_id || '/1.jpg', p_sha);
  update public.capture set status = 'processing' where id = p_id;
  insert into public.processing_run (capture_id, household_id) values (p_id, test.hh('a')) returning id into v_run;
  return v_run;
end $$;

create function test.receipt_payload(p_store text, p_date_conf numeric, p_total numeric, p_line_conf numeric) returns jsonb
language sql as $$
  select jsonb_build_object(
    'kind', 'receipt',
    'store_hint', jsonb_build_object('name', p_store, 'branch_name', 'BSD'),
    'header', jsonb_build_object('transaction_date', (current_date - 1)::text, 'total_amount', p_total,
                                 'payment_method', 'debit',
                                 'field_confidence', jsonb_build_object('store', 0.97, 'date', p_date_conf, 'total', 0.99, 'warna', 1)),
    'pii', jsonb_build_object('card_last4', '4321'),
    'lines', jsonb_build_array(
      jsonb_build_object('line_no', 1, 'line_type', 'product', 'raw_text', 'MILO ORI 500G', 'quantity', 2, 'unit_amount', 45000,
                         'line_amount', 90000, 'parse_confidence', 0.99,
                         'match', jsonb_build_object('product_id', '70000000-0000-0000-0000-000000000500', 'tier', 'barcode', 'confidence', 1)),
      jsonb_build_object('line_no', 2, 'line_type', 'discount', 'raw_text', 'DISC MEMBER', 'line_amount', -5000, 'applies_to_line_no', 1),
      jsonb_build_object('line_no', 3, 'line_type', 'product', 'raw_text', 'MILO 3IN1', 'quantity', 1, 'unit_amount', 21000,
                         'line_amount', 21000, 'parse_confidence', p_line_conf,
                         'match', jsonb_build_object('product_id', '70000000-0000-0000-0000-000000000310', 'tier', 'alias', 'confidence', 0.95)),
      jsonb_build_object('line_no', 4, 'line_type', 'non_product', 'raw_text', 'KANTONG', 'quantity', 1, 'unit_amount', 200, 'line_amount', 200)),
    'adjustments', jsonb_build_array(jsonb_build_object('kind', 'voucher', 'description', 'VOUCHER 10RB', 'amount', -10000)))
$$;

-- (a) semua layak → auto-save, confirmed, done, tanpa alias
select test.ok((select r ->> 'status' = 'done' and (r ->> 'auto_saved')::int = 2
                  from app.apply_extraction('cb000000-0000-0000-0000-000000000001',
                         test.new_capture('cb000000-0000-0000-0000-000000000001', 'receipt', repeat('a', 64)),
                         test.receipt_payload('AEON', 0.95, 106200, 0.97)) r),
               '§5.5: header dan baris ≥ τ → semua auto-save, capture done');
create temp table rc1 as select id from public.receipt where capture_id = 'cb000000-0000-0000-0000-000000000001';
select test.ok((select status = 'confirmed' and store_id = '20000000-0000-0000-0000-000000000001'
                       and branch_id = '30000000-0000-0000-0000-000000000001' and pii ->> 'card_last4' = '4321'
                       and field_confidence = '{"date": 0.95, "store": 0.97, "total": 0.99}'::jsonb
                  from public.receipt where id = (select id from rc1)),
               'struk: toko + cabang terbaca, pii tersimpan terpisah, field_confidence disaring');
select test.ok((select count(*) = 2 and bool_and(match_outcome = 'auto')
                  from public.price_record where capture_id = 'cb000000-0000-0000-0000-000000000001'),
               '2 record auto');
select test.ok((select effective_price = 42500 and price_basis = 'promo' and extra #>> '{member_hint,text}' = 'DISC MEMBER'
                  from public.price_record where capture_id = 'cb000000-0000-0000-0000-000000000001'
                   and product_id = '70000000-0000-0000-0000-000000000500'),
               'D-63: diskon member di struk → harga dibayar, promo, member_hint');
select test.ok((select count(*) = 1 from public.receipt_adjustment where receipt_id = (select id from rc1)), 'voucher struk tersimpan (D-01)');
select test.ok(not exists (select 1 from public.product_alias where household_id = test.hh('a')
                            and store_id = '20000000-0000-0000-0000-000000000001'),
               'auto-save tidak membuat alias');
select test.ok((select status = 'succeeded' and finished_at is not null from public.processing_run
                 where capture_id = 'cb000000-0000-0000-0000-000000000001'), 'run succeeded');

-- (b) sidik jari sama → tidak pernah auto-save (D-50)
select test.ok((select r ->> 'status' = 'needs_confirmation' and (r ->> 'auto_saved')::int = 0
                       and r ->> 'duplicate_of' = (select id::text from rc1)
                  from app.apply_extraction('cb000000-0000-0000-0000-000000000002',
                         test.new_capture('cb000000-0000-0000-0000-000000000002', 'receipt', repeat('b', 64)),
                         test.receipt_payload('AEON', 0.95, 106200, 0.97)) r),
               'D-50: struk dicurigai duplikat tidak pernah di-auto-save');
-- (c) toko tidak dikenal → store NULL (D-49), konfirmasi
select test.ok((select r ->> 'status' = 'needs_confirmation' and r -> 'store_id' = 'null' and (r ->> 'auto_saved')::int = 0
                  from app.apply_extraction('cb000000-0000-0000-0000-000000000003',
                         test.new_capture('cb000000-0000-0000-0000-000000000003', 'receipt', repeat('c', 64)),
                         test.receipt_payload('Toko Tak Dikenal', 0.95, 106200, 0.97)) r),
               'D-49: toko kosong → draft tanpa toko, tidak auto-save');
-- (d) confidence tanggal < τ → konfirmasi (Q-13)
select test.ok((select r ->> 'status' = 'needs_confirmation' and (r ->> 'auto_saved')::int = 0
                  from app.apply_extraction('cb000000-0000-0000-0000-000000000004',
                         test.new_capture('cb000000-0000-0000-0000-000000000004', 'receipt', repeat('d', 64)),
                         test.receipt_payload('Alfamart', 0.5, 1, 0.97)) r),
               'D-71: header tanggal < τ → tidak auto-save');
-- (e) selisih total besar tetap auto-save; (f) baris < τ menunggu konfirmasi
select test.ok((select r ->> 'status' = 'needs_confirmation' and (r ->> 'auto_saved')::int = 1
                  from app.apply_extraction('cb000000-0000-0000-0000-000000000005',
                         test.new_capture('cb000000-0000-0000-0000-000000000005', 'receipt', repeat('e', 64)),
                         test.receipt_payload('Alfamart', 0.95, 999999, 0.5)) r),
               'D-50: selisih total tidak memaksa konfirmasi; baris < τ menunggu, baris ≥ τ tersimpan');
select test.ok((select status = 'draft' from public.receipt where capture_id = 'cb000000-0000-0000-0000-000000000005'),
               'struk tetap draft sampai semua baris diputuskan');
-- (g) hash gambar sama dengan capture lain → tidak auto-save (Q-29)
select test.ok((select r ->> 'status' = 'needs_confirmation' and (r ->> 'hash_duplicate')::boolean
                       and r ->> 'duplicate_of' = (select id::text from rc1)
                  from app.apply_extraction('cb000000-0000-0000-0000-000000000006',
                         test.new_capture('cb000000-0000-0000-0000-000000000006', 'receipt', repeat('a', 64)),
                         test.receipt_payload('Alfamidi', 0.95, 5, 0.97)) r),
               'Q-29: hash gambar duplikat → dicurigai di konfirmasi');
select test.ok(app.apply_extraction('cb000000-0000-0000-0000-000000000006',
                 (select id from public.processing_run where capture_id = 'cb000000-0000-0000-0000-000000000006'),
                 test.receipt_payload('Alfamidi', 0.95, 5, 0.97)) ->> 'status' = 'stale',
               '§5.5: apply kedua untuk run yang sama ditolak (idempoten)');

-- ---------------------------------------------------------------------------
-- apply_extraction: label harga (sesi aktif)
-- ---------------------------------------------------------------------------
insert into public.shopping_session (id, household_id, branch_id)
values ('5e000000-0000-0000-0000-000000000002', test.hh('a'), '30000000-0000-0000-0000-000000000002');
create temp table obs as
select app.apply_extraction('cc000000-0000-0000-0000-000000000001',
  test.new_capture('cc000000-0000-0000-0000-000000000001', 'price_label', repeat('f', 64), '5e000000-0000-0000-0000-000000000002'),
  '{"kind": "price_label", "items": [
     {"raw_text": "INDOMIE GRG 85G", "normal_price": 3500, "promo_price": 3000, "promo_valid_until": "2099-01-01",
      "field_confidence": {"price": 0.99}, "image_position": 1, "region": {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.2},
      "match": {"product_id": "70000000-0000-0000-0000-000000000200", "tier": "alias", "confidence": 0.98,
                "candidates": [{"product_id": "70000000-0000-0000-0000-000000000200"}, {"product_id": "7a000000-0000-0000-0000-000000000099"}]}},
     {"raw_text": "MILO 500", "normal_price": 47000, "field_confidence": {"price": 0.6},
      "match": {"product_id": "70000000-0000-0000-0000-000000000500", "tier": "fuzzy", "confidence": 0.99}},
     {"raw_text": "PAKET MILO", "normal_price": 60000, "is_bundle": true,
      "match": {"product_id": "70000000-0000-0000-0000-000000000500", "tier": "fuzzy", "confidence": 0.99}},
     {"raw_text": "MILO 3IN1", "normal_price": 23000, "member_price": 20000, "member_program_name": "Alfagift",
      "match": {"product_id": "70000000-0000-0000-0000-000000000310", "tier": "alias", "confidence": 0.95}},
     {"raw_text": "MILO UHT", "normal_price": 6000, "member_price": 5000, "member_program_name": "Klub Rahasia",
      "match": {"product_id": "70000000-0000-0000-0000-000000000180", "tier": "alias", "confidence": 0.5}}]}') as r;
select test.ok((select r ->> 'status' = 'needs_confirmation' and (r ->> 'auto_saved')::int = 2 and (r ->> 'pending')::int = 3 from obs),
               '§5.5: 2 item auto-accept, 3 menunggu (confidence harga rendah, bundle, confidence produk rendah)');
select test.ok((select pr.store_id = '20000000-0000-0000-0000-000000000002' and pr.branch_id = '30000000-0000-0000-0000-000000000002'
                       and pr.price_basis = 'promo' and pr.effective_price = 3000 and pr.match_outcome = 'auto'
                  from public.capture_item i join public.price_record pr on pr.id = i.price_record_id
                 where i.capture_id = 'cc000000-0000-0000-0000-000000000001' and i.position = 1),
               'item auto: lokasi dari sesi, promo aktif');
select test.ok((select i.candidate_product_ids = array['70000000-0000-0000-0000-000000000200'::uuid]
                       and i.region ->> 'w' = '0.3' and i.transaction_date = current_date
                  from public.capture_item i where i.capture_id = 'cc000000-0000-0000-0000-000000000001' and i.position = 1),
               'kandidat di luar katalog household dibuang; region dan tanggal default tersimpan');
select test.ok((select member_program_id = '40000000-0000-0000-0000-000000000002' and member_price = 20000
                  from public.capture_item where capture_id = 'cc000000-0000-0000-0000-000000000001' and position = 4),
               'program member terbaca dicocokkan ke katalog toko');
select test.ok((select pr.price_basis = 'normal' and pr.extra -> 'member_eligible' = 'false'
                  from public.capture_item i join public.price_record pr on pr.id = i.price_record_id
                 where i.capture_id = 'cc000000-0000-0000-0000-000000000001' and i.position = 4),
               'D-27: bukan member Alfagift → harga normal, snapshot false');
select test.ok((select member_price is null and extra ->> 'member_note' like 'Klub Rahasia%'
                  from public.capture_item where capture_id = 'cc000000-0000-0000-0000-000000000001' and position = 5),
               'D-52: program di luar katalog → extra.member_note');
select test.ok((select status = 'pending' and is_bundle from public.capture_item
                 where capture_id = 'cc000000-0000-0000-0000-000000000001' and position = 3),
               'D-08: bundle tidak di-auto-accept');

-- Label tanpa lokasi apa pun → semua pending (STORE_REQUIRED dicegah)
select test.ok((select r ->> 'status' = 'needs_confirmation' and (r ->> 'auto_saved')::int = 0
                  from app.apply_extraction('cc000000-0000-0000-0000-000000000002',
                         test.new_capture('cc000000-0000-0000-0000-000000000002', 'price_label', repeat('9', 64)),
                         '{"items": [{"raw_text": "MILO", "normal_price": 1, "match": {"product_id": "70000000-0000-0000-0000-000000000200", "confidence": 1}}]}') r),
               'toko tidak diketahui → item tidak di-auto-accept');
-- Marketplace: lokasi dari store_hint platform
select test.ok((select r ->> 'status' = 'done' and r ->> 'store_id' = '20000000-0000-0000-0000-000000000004'
                  from app.apply_extraction('cc000000-0000-0000-0000-000000000003',
                         test.new_capture('cc000000-0000-0000-0000-000000000003', 'marketplace', repeat('8', 64)),
                         '{"store_hint": {"name": "shopee"}, "items": [{"raw_text": "Milo 500g", "normal_price": 46000, "shipping_fee": 9000,
                           "listing_title": "MILO 500G ORI", "seller_name": "Nestle Official Store", "seller_ref": "nestle-official",
                           "match": {"product_id": "70000000-0000-0000-0000-000000000500", "tier": "fuzzy", "confidence": 0.95}}]}') r),
               'marketplace: platform dari store_hint, item auto');
select test.ok((select pr.branch_id = '30000000-0000-0000-0000-000000000005' and (pr.extra ->> 'shipping_fee')::numeric = 9000
                       and pr.effective_price = 46000 and pr.source_type = 'marketplace'
                  from public.price_record pr where pr.capture_id = 'cc000000-0000-0000-0000-000000000003'),
               'seller global dipakai; ongkir info saja (D-36)');

-- ---------------------------------------------------------------------------
-- Retensi (D-32, Q-14), redaksi OCR (§7.4), unggahan yatim (§5.2)
-- ---------------------------------------------------------------------------
update public.capture_image set purge_after = now() - interval '1 day' where capture_id = 'cb000000-0000-0000-0000-000000000001';
update public.processing_run set raw_ocr_text = 'KARTU 4321 HP 081234567890', raw_ai_output = '{"pii": {"card_last4": "4321"}}'
 where capture_id = 'cb000000-0000-0000-0000-000000000001';
update public.capture set processed_at = now() - interval '8 days' where id = 'cb000000-0000-0000-0000-000000000001';
select test.ok((select (r ->> 'purge_images')::int = 1 and (r ->> 'redact_ocr')::int = 1 from app.enqueue_retention() r),
               'enqueue_retention: 1 gambar jatuh tempo, 1 run perlu redaksi');
select test.ok((select (r ->> 'purge_images')::int = 0 and (r ->> 'redact_ocr')::int = 0 from app.enqueue_retention() r),
               'enqueue_retention idempoten selama job aktif');
create temp table pj as select * from app.claim_job(array['purge_images']);
select test.ok((select count(*) = 1 from app.images_to_purge(array(select jsonb_array_elements_text(payload -> 'image_ids')::uuid from pj))),
               'job purge: daftar path');
select test.ok(app.mark_images_purged(array(select jsonb_array_elements_text(payload -> 'image_ids')::uuid from pj)) = 1,
               'tandai gambar terhapus');
select app.complete_job((select id from pj));
select test.ok((select purged_at is not null from public.capture_image where capture_id = 'cb000000-0000-0000-0000-000000000001')
               and (select pii = '{}' from public.receipt where capture_id = 'cb000000-0000-0000-0000-000000000001'),
               'Q-14: receipt.pii dikosongkan bersama purge gambar; baris gambar tetap');
create temp table rj as select * from app.claim_job(array['redact_ocr']);
select test.ok((select count(*) = 1 from app.runs_to_redact(array(select jsonb_array_elements_text(payload -> 'run_ids')::uuid from rj))),
               'job redaksi: run yang belum disamarkan');
select test.ok(app.apply_redaction((select (payload ->> 'run_ids')::jsonb ->> 0 from rj)::uuid, 'KARTU [REDAKSI]', '{}'), 'redaksi tersimpan');
select test.ok((select pii_redacted_at is not null and raw_ocr_text = 'KARTU [REDAKSI]' from public.processing_run
                 where capture_id = 'cb000000-0000-0000-0000-000000000001'), 'pii_redacted_at terisi');

insert into storage.objects (bucket_id, name, created_at) values
  ('captures', test.hh('a') || '/dd000000-0000-0000-0000-000000000001/1.jpg', now() - interval '25 hours'),
  ('captures', test.hh('a') || '/dd000000-0000-0000-0000-000000000002/1.jpg', now() - interval '1 hour');
select test.ok((select array_agg(name) = array[test.hh('a') || '/dd000000-0000-0000-0000-000000000001/1.jpg']
                  from app.orphan_storage_objects()),
               '§5.2: unggahan yatim > 24 jam terdeteksi, yang baru tidak');

-- Job: klaim, lease, reaper job
insert into app.job (kind, payload) values ('purge_storage_paths', '{"paths": []}');
create temp table lj as select * from app.claim_job(array['purge_storage_paths'], 1);
update app.job set run_after = now() - interval '1 second' where id = (select id from lj);
select app.reap_stale_runs();
select test.ok((select status = 'pending' from app.job where id = (select id from lj)), 'lease job habis → kembali pending');

-- Hak: fungsi worker tidak bisa dipanggil user
select test.login(test.uid('a'));
select test.expect_code($$select * from app.claim_next_capture('x')$$, '42501', 'authenticated tidak bisa mengklaim capture');
select test.expect_code($$select app.apply_extraction(gen_random_uuid(), gen_random_uuid(), '{}')$$, '42501',
                        'authenticated tidak bisa menjalankan apply_extraction');
select test.logout();
