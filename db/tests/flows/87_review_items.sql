-- 87 · Item tinjauan Tahap 6 (docs/08 §11.1 #6, §11.2, §13.2 L1; Tahap 6b M4):
--   Q-77 read_member_* + pemetaan ulang W18, R18 item_status/thumbnail_path/vs_best_pct tanpa
--   record sesi (Q-80/Q-81/Q-97), R20 source_text (Q-87).
\ir ../lib/harness.sql
\ir ../lib/seed.sql

create function test.new_capture(p_id uuid, p_kind text, p_session uuid default null) returns uuid
language plpgsql as $$
declare v_run uuid;
begin
  insert into public.capture (id, household_id, kind, shopping_session_id) values (p_id, test.hh('a'), p_kind, p_session);
  insert into public.capture_image (capture_id, household_id, position, storage_path, sha256)
  values (p_id, test.hh('a'), 1, test.hh('a') || '/' || p_id || '/1.jpg', md5(p_id::text) || md5(p_id::text));
  update public.capture set status = 'processing' where id = p_id;
  insert into public.processing_run (capture_id, household_id) values (p_id, test.hh('a')) returning id into v_run;
  return v_run;
end $$;

create function test.item(p_capture uuid, p_pos int) returns public.capture_item
language sql stable as $$ select * from public.capture_item where capture_id = p_capture and position = p_pos $$;

create function test.patch(p_capture uuid, p_pos int, p_patch jsonb) returns jsonb
language sql as $$
  select public.update_capture_item((test.item(p_capture, p_pos)).id, p_patch, (test.item(p_capture, p_pos)).updated_at)
$$;

-- ---------------------------------------------------------------------------
-- Q-77: label tanpa toko → member_note + nilai terbaca tersimpan
-- ---------------------------------------------------------------------------
select app.apply_extraction('ca000000-0000-0000-0000-000000000001',
  test.new_capture('ca000000-0000-0000-0000-000000000001', 'price_label'),
  '{"kind": "price_label", "items": [
     {"raw_text": "MILO 3IN1", "normal_price": 23000, "member_price": 21000, "member_program_name": "AEON Member",
      "match": {"product_id": "70000000-0000-0000-0000-000000000310", "tier": "fuzzy", "confidence": 0.6}},
     {"raw_text": "MILO UHT", "normal_price": 6000, "member_price": 5000,
      "match": {"product_id": "70000000-0000-0000-0000-000000000180", "tier": "fuzzy", "confidence": 0.6}},
     {"raw_text": "MILO 200G", "normal_price": 20000,
      "match": {"product_id": "70000000-0000-0000-0000-000000000200", "tier": "fuzzy", "confidence": 0.6}}]}');

select test.ok((select store_id is null and member_price is null and member_program_id is null
                       and extra ->> 'member_note' = 'AEON Member 21000'
                       and read_member_price = 21000 and read_member_program_name = 'AEON Member'
                  from test.item('ca000000-0000-0000-0000-000000000001', 1)),
               'Q-77: tanpa toko → member_note; read_member_price/read_member_program_name terisi');
select test.ok((select read_member_price = 5000 and read_member_program_name is null and extra ->> 'member_note' = 'Harga member 5000'
                  from test.item('ca000000-0000-0000-0000-000000000001', 2)),
               'Q-77: program tidak terbaca → read_member_program_name NULL');
select test.ok((select read_member_price is null and read_member_program_name is null
                  from test.item('ca000000-0000-0000-0000-000000000001', 3)),
               'Q-77: tanpa harga member → kolom terbaca NULL');

select test.login(test.uid('a'));

-- Kolom terbaca tidak bisa diubah user (tanpa GRANT UPDATE kolom).
select test.expect_code($$update public.capture_item set read_member_price = 1
                           where capture_id = 'ca000000-0000-0000-0000-000000000001' and position = 1$$,
                        '42501', 'Q-77: user tidak bisa mengubah read_member_price');
select test.expect_code(format($$select public.update_capture_item(%L, '{"read_member_price": 1}', %L)$$,
                               (test.item('ca000000-0000-0000-0000-000000000001', 1)).id,
                               (test.item('ca000000-0000-0000-0000-000000000001', 1)).updated_at),
                        'INVALID_INPUT', 'W18: read_member_* bukan kunci patch');

-- W18: pilih toko AEON → program terbaca dipetakan, member_note dihapus.
select test.ok((select x ->> 'member_program_id' = '40000000-0000-0000-0000-000000000001'
                       and (x ->> 'member_price')::numeric = 21000 and not (x -> 'extra') ? 'member_note'
                  from test.patch('ca000000-0000-0000-0000-000000000001', 1,
                                  '{"store_id": "20000000-0000-0000-0000-000000000001", "branch_id": "30000000-0000-0000-0000-000000000001"}') x),
               'Q-77/W18: lokasi dipilih → member_price + program toko, catatan dihapus (hasil R16)');
select test.patch('ca000000-0000-0000-0000-000000000001', 2,
                  '{"store_id": "20000000-0000-0000-0000-000000000001"}');
select test.ok((select member_program_id = '40000000-0000-0000-0000-000000000001' and member_price = 5000
                       and not extra ? 'member_note'
                  from test.item('ca000000-0000-0000-0000-000000000001', 2)),
               'Q-77/W18: nama program tidak terbaca → satu-satunya program aktif toko (aturan §5.5)');
select test.ok((select x #>> '{computed,price_basis}' = 'normal' and not (x #>> '{computed,member_eligible}')::boolean
                  from public.get_capture_items('ca000000-0000-0000-0000-000000000001') x where (x ->> 'position')::int = 1),
               'Q-77: pratinjau R16 memakai program hasil pemetaan (belum member → normal)');

-- Pindah ke toko yang programnya tidak cocok → kembali jadi catatan.
select test.patch('ca000000-0000-0000-0000-000000000001', 1,
                  '{"store_id": "20000000-0000-0000-0000-000000000002", "branch_id": null}');
select test.ok((select member_program_id is null and member_price is null and extra ->> 'member_note' = 'AEON Member 21000'
                  from test.item('ca000000-0000-0000-0000-000000000001', 1)),
               'Q-77/W18: program toko lama tidak berlaku di toko baru → member_note lagi');
-- Patch yang mengubah member sekaligus: pilihan user menang, tanpa pemetaan ulang.
select test.patch('ca000000-0000-0000-0000-000000000001', 1,
                  '{"store_id": "20000000-0000-0000-0000-000000000002", "member_price": 19000,
                                    "member_program_id": "40000000-0000-0000-0000-000000000002"}');
select test.ok((select member_program_id = '40000000-0000-0000-0000-000000000002' and member_price = 19000
                  from test.item('ca000000-0000-0000-0000-000000000001', 1)),
               'Q-77/W18: member diisi user di patch yang sama → tidak dipetakan ulang');
-- Toko berubah tetapi program user masih milik toko itu → tetap.
select test.patch('ca000000-0000-0000-0000-000000000001', 1,
                  '{"store_id": "20000000-0000-0000-0000-000000000002", "branch_id": "30000000-0000-0000-0000-000000000002"}');
select test.ok((select member_program_id = '40000000-0000-0000-0000-000000000002' and member_price = 19000
                  from test.item('ca000000-0000-0000-0000-000000000001', 1)),
               'Q-77/W18: program yang sudah cocok dengan toko tidak diubah');
select test.patch('ca000000-0000-0000-0000-000000000001', 3,
                  '{"store_id": "20000000-0000-0000-0000-000000000001"}');
select test.ok((select member_program_id is null and member_price is null and not extra ? 'member_note'
                  from test.item('ca000000-0000-0000-0000-000000000001', 3)),
               'Q-77/W18: item tanpa harga member terbaca tidak berubah');
select test.ok((select count(*) >= 4 from public.audit_log
                 where entity_type = 'capture_item' and entity_id = (test.item('ca000000-0000-0000-0000-000000000001', 1)).id),
               'Q-77/W18: perubahan (termasuk pemetaan ulang) tercatat di audit');
select test.logout();

-- ---------------------------------------------------------------------------
-- R18: item_status, thumbnail_path, vs_best_pct tanpa record sesi (Q-80/Q-81/Q-97)
-- ---------------------------------------------------------------------------
-- Record lama di luar sesi: Milo 500 g Rp50.000 di AEON (auto).
select app.apply_extraction('ca000000-0000-0000-0000-000000000002',
  test.new_capture('ca000000-0000-0000-0000-000000000002', 'price_label'),
  '{"kind": "price_label", "store_hint": {"name": "AEON"}, "items": [
     {"raw_text": "MILO 500G", "normal_price": 50000, "field_confidence": {"price": 0.99},
      "match": {"product_id": "70000000-0000-0000-0000-000000000500", "tier": "alias", "confidence": 0.98}}]}');

insert into public.shopping_session (id, household_id, branch_id)
values ('5e000000-0000-0000-0000-000000000001', test.hh('a'), '30000000-0000-0000-0000-000000000001');
-- Label sesi: Milo 500 g Rp45.000 (auto-accept) + Milo 3in1 (perlu dicek).
select app.apply_extraction('ca000000-0000-0000-0000-000000000003',
  test.new_capture('ca000000-0000-0000-0000-000000000003', 'price_label', '5e000000-0000-0000-0000-000000000001'),
  '{"kind": "price_label", "items": [
     {"raw_text": "MILO 500G", "normal_price": 45000, "field_confidence": {"price": 0.99},
      "match": {"product_id": "70000000-0000-0000-0000-000000000500", "tier": "alias", "confidence": 0.98}},
     {"raw_text": "MILO 3IN1", "normal_price": 23000,
      "match": {"product_id": "70000000-0000-0000-0000-000000000310", "tier": "fuzzy", "confidence": 0.6}}]}');
-- Label sesi kedua masih diproses (tanpa item).
select test.new_capture('ca000000-0000-0000-0000-000000000004', 'price_label', '5e000000-0000-0000-0000-000000000001');
select app.process_summary_queue();

select test.ok((select best_90d_unit_price = (select unit_price from public.price_record pr
                                               join public.capture_item i on i.price_record_id = pr.id
                                              where i.capture_id = 'ca000000-0000-0000-0000-000000000003')
                  from public.price_summary where household_id = test.hh('a')
                   and product_id = '70000000-0000-0000-0000-000000000500'),
               'R18 (prasyarat F-60): ringkasan sudah memuat record label sesi sebagai termurah');

select test.login(test.uid('a'));
create temp table r18 as select l from public.get_active_session() s, jsonb_array_elements(s -> 'labels') l;
select test.ok((select count(*) = 3 from r18), 'R18: satu baris per item (+ satu foto tanpa item)');
select test.ok((select l ->> 'item_status' = 'accepted' and (l ->> 'vs_best_pct')::numeric = -10.0
                       and (l ->> 'effective_price')::numeric = 45000
                  from r18 where l #>> '{product,id}' = '70000000-0000-0000-0000-000000000500'),
               'Q-80: vs_best_pct dibanding termurah 90 hari TANPA record sesi (−10 %, bukan 0 %)');
select test.ok((select l ->> 'item_status' = 'pending' and l ->> 'vs_best_pct' is null
                  from r18 where l #>> '{product,id}' = '70000000-0000-0000-0000-000000000310'),
               'Q-81: item perlu dicek → item_status pending; tanpa histori → vs_best_pct NULL');
select test.ok((select l -> 'item_status' = 'null' and l -> 'item_id' = 'null' and l ->> 'status' = 'processing'
                  from r18 where l ->> 'capture_id' = 'ca000000-0000-0000-0000-000000000004'),
               'Q-81: foto tanpa item → item_status NULL');
select test.ok((select bool_and(l ->> 'thumbnail_path' = test.hh('a') || '/' || (l ->> 'capture_id') || '/1.jpg') from r18),
               'Q-97: thumbnail_path = storage_path gambar posisi 1');
select test.logout();

-- Pembanding mengikuti aturan ringkasan: record void, bundle, mata uang lain, di luar 90 hari tidak dihitung.
update public.price_record set transaction_date = current_date - 120
 where id = (select price_record_id from test.item('ca000000-0000-0000-0000-000000000002', 1));
select test.login(test.uid('a'));
select test.ok((select (l ->> 'vs_best_pct') is null from public.get_active_session() s, jsonb_array_elements(s -> 'labels') l
                 where l #>> '{product,id}' = '70000000-0000-0000-0000-000000000500'),
               'Q-80: record di luar jendela 90 hari tidak dihitung; hanya record sesi → NULL');
select test.logout();
update public.price_record set transaction_date = current_date
 where id = (select price_record_id from test.item('ca000000-0000-0000-0000-000000000002', 1));

-- Gambar sudah di-purge → thumbnail NULL.
update public.capture_image set purged_at = now() where capture_id = 'ca000000-0000-0000-0000-000000000003';
select test.login(test.uid('a'));
select test.ok((select bool_and(l -> 'thumbnail_path' = 'null') from public.get_active_session() s, jsonb_array_elements(s -> 'labels') l
                 where l ->> 'capture_id' = 'ca000000-0000-0000-0000-000000000003'),
               'Q-97: gambar sudah di-purge → thumbnail_path NULL');
select test.logout();

-- Helper hanya untuk household sendiri (DEFINER).
select test.login(test.uid('b'));
select test.ok(app.best_unit_price_excluding('70000000-0000-0000-0000-000000000500', test.hh('a'), '{}') is null,
               'Q-80: best_unit_price_excluding tidak membaca household lain');
select test.logout();
select test.login(test.uid('a'));
select test.ok(app.best_unit_price_excluding('70000000-0000-0000-0000-000000000500', test.hh('a'), '{}')
               < app.best_unit_price_excluding('70000000-0000-0000-0000-000000000500', test.hh('a'),
                                               array['ca000000-0000-0000-0000-000000000003'::uuid]),
               'Q-80: capture dikecualikan → termurah berikutnya');
select test.logout();
select test.expect_code($$set role anon; select app.best_unit_price_excluding(null, null, null)$$, '42501',
                        'Q-80: anon tidak bisa memanggil helper');
reset role;

-- ---------------------------------------------------------------------------
-- R20 source_text (Q-87, F-72)
-- ---------------------------------------------------------------------------
select app.apply_extraction('cb000000-0000-0000-0000-000000000001',
  test.new_capture('cb000000-0000-0000-0000-000000000001', 'receipt'),
  jsonb_build_object('kind', 'receipt', 'store_hint', jsonb_build_object('name', 'AEON'),
    'header', jsonb_build_object('transaction_date', current_date::text, 'total_amount', 90000,
                                 'field_confidence', jsonb_build_object('store', 0.99, 'date', 0.99)),
    'pii', '{}'::jsonb, 'adjustments', '[]'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'line_type', 'product', 'raw_text', 'MILO ORI 500G',
      'quantity', 2, 'unit_amount', 45000, 'line_amount', 90000, 'parse_confidence', 0.99,
      'match', jsonb_build_object('product_id', '70000000-0000-0000-0000-000000000500', 'tier', 'barcode', 'confidence', 1)))));
select app.apply_extraction('cc000000-0000-0000-0000-000000000001',
  test.new_capture('cc000000-0000-0000-0000-000000000001', 'marketplace'),
  '{"kind": "marketplace", "store_hint": {"name": "Shopee"}, "items": [
     {"raw_text": "Milo Original 500 g", "listing_title": "Milo Original 500 g Nestle", "normal_price": 47000,
      "field_confidence": {"price": 0.99},
      "match": {"product_id": "70000000-0000-0000-0000-000000000500", "tier": "fuzzy", "confidence": 0.99}}]}');

select test.login(test.uid('a'));
select test.ok((select public.price_record_detail(pr.id) ->> 'source_text' = 'MILO ORI 500G'
                  from public.price_record pr where pr.capture_id = 'cb000000-0000-0000-0000-000000000001'),
               'R20: source_text record struk = receipt_line.raw_text');
select test.ok((select public.price_record_detail(pr.id) ->> 'source_text' = 'MILO 500G'
                  from public.price_record pr where pr.capture_id = 'ca000000-0000-0000-0000-000000000003'),
               'R20: source_text record label = capture_item.raw_text');
select test.ok((select public.price_record_detail(pr.id) ->> 'source_text' = 'Milo Original 500 g Nestle'
                  from public.price_record pr where pr.capture_id = 'cc000000-0000-0000-0000-000000000001'),
               'R20: source_text record screenshot = judul listing (aturan alias W6)');
select test.ok((select (public.price_record_detail(pr.id) ? 'record') and (public.price_record_detail(pr.id) ? 'history')
                  from public.price_record pr where pr.capture_id = 'cc000000-0000-0000-0000-000000000001'),
               'R20: kunci lama tetap ada (aditif)');
select test.logout();
