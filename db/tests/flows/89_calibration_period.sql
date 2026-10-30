-- 89 · Masa kalibrasi matching M3 (migration …0200, docs/08 §8.2 no. 1): auto_save_min_confidence =
--      1,01 → tidak ada yang di-auto-save walau semua confidence 1; saran tetap tersimpan untuk
--      calibration_report.sql. Test lain memakai τ 0,90 dari lib/seed.sql.
\ir ../lib/harness.sql

-- Nilai dari migration (sebelum seed test menimpanya).
select test.ok(app.config_numeric('auto_save_min_confidence') = 1.01, '§8.2: migration masa kalibrasi → τ = 1,01');
select test.ok((select value #>> '{}' = '2026-10-30' from app.config where key = 'calibration_started_on'),
               '§8.2: calibration_started_on tercatat');
select test.ok(app.config_numeric('ai_match_max_confidence') < app.config_numeric('auto_save_min_confidence'),
               'Q-108: batas tier 4 tetap di bawah τ');

\ir ../lib/seed.sql
update app.config set value = '1.01' where key = 'auto_save_min_confidence';

select test.login(test.uid('a'));
select test.ok((select (public.get_client_config() -> 'auto_save_min_confidence')::numeric = 1.01),
               'R2: klien menerima τ masa kalibrasi');
select test.logout();

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

-- Struk: header dan semua baris confidence 1, cocok barcode → tetap dikonfirmasi user.
create temp table rc as
select app.apply_extraction('cd000000-0000-0000-0000-000000000001',
  test.new_capture('cd000000-0000-0000-0000-000000000001', 'receipt', repeat('c', 64)),
  jsonb_build_object(
    'kind', 'receipt',
    'store_hint', jsonb_build_object('name', 'AEON', 'branch_name', 'BSD'),
    'header', jsonb_build_object('transaction_date', (current_date - 1)::text, 'total_amount', 90000, 'payment_method', 'debit',
                                 'field_confidence', jsonb_build_object('store', 1, 'date', 1, 'total', 1)),
    'lines', jsonb_build_array(
      jsonb_build_object('line_no', 1, 'line_type', 'product', 'raw_text', 'MILO ORI 500G', 'quantity', 2, 'unit_amount', 45000,
                         'line_amount', 90000, 'parse_confidence', 1,
                         'match', jsonb_build_object('product_id', '70000000-0000-0000-0000-000000000500', 'tier', 'barcode', 'confidence', 1))))) as r;
select test.ok((select r ->> 'status' = 'needs_confirmation' and (r ->> 'auto_saved')::int = 0 from rc),
               '§8.2: struk dengan confidence 1 tidak di-auto-save selama masa kalibrasi');
select test.ok((select count(*) = 0 from public.price_record where capture_id = 'cd000000-0000-0000-0000-000000000001'),
               'belum ada price_record sebelum user mengonfirmasi');
select test.ok((select l.suggested_product_id = '70000000-0000-0000-0000-000000000500' and l.match_tier = 'barcode' and l.match_confidence = 1
                  from public.receipt_line l join public.receipt r on r.id = l.receipt_id
                 where r.capture_id = 'cd000000-0000-0000-0000-000000000001' and l.line_no = 1),
               'saran sistem tetap tersimpan (bahan calibration_report.sql)');

-- Label di sesi belanja aktif: alias household 0,98 → tetap pending.
insert into public.shopping_session (id, household_id, branch_id)
values ('5e000000-0000-0000-0000-000000000009', test.hh('a'), '30000000-0000-0000-0000-000000000001');
select test.ok((select r ->> 'status' = 'needs_confirmation' and (r ->> 'auto_saved')::int = 0 and (r ->> 'pending')::int = 1
                  from app.apply_extraction('cd000000-0000-0000-0000-000000000002',
                         test.new_capture('cd000000-0000-0000-0000-000000000002', 'price_label', repeat('d', 64), '5e000000-0000-0000-0000-000000000009'),
                         '{"kind": "price_label", "items": [{"raw_text": "MILO ORI 500G", "normal_price": 47000, "field_confidence": {"price": 1},
                           "match": {"product_id": "70000000-0000-0000-0000-000000000500", "tier": "barcode", "confidence": 1}}]}') r),
               '§8.2: label dengan confidence 1 tidak di-auto-accept selama masa kalibrasi');
select test.ok((select status = 'pending' and suggested_product_id = '70000000-0000-0000-0000-000000000500'
                  from public.capture_item where capture_id = 'cd000000-0000-0000-0000-000000000002'),
               'item label pending dengan saran tersimpan');

-- Laporan kalibrasi: tanpa -v since memakai calibration_started_on.
\ir ../../scripts/calibration_report.sql
select test.ok(:'since' = '2026-10-30', 'calibration_report.sql: default since = calibration_started_on');
