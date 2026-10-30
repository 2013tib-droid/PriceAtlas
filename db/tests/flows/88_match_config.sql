-- 88 · Matching dari config + daftar pendek tier 4 (docs/08 §7.2, §8.2, §11.1 #1–#3, §13.2 L1;
--   Tahap 6b M2/M3). Hasil match_products dengan config default dibuktikan identik oleh 70.
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- ---------------------------------------------------------------------------
-- Kunci baru dengan default = konstanta lama
-- ---------------------------------------------------------------------------
select test.ok(app.config_numeric('match_conf_barcode') = 1.00 and app.config_numeric('match_conf_alias_household') = 0.98
               and app.config_numeric('match_conf_alias_global') = 0.95 and app.config_numeric('match_conf_alias_group') = 0.70
               and app.config_numeric('fuzzy_max_confidence') = 1.00, '§8.2: default kunci tier = perilaku lama');
select test.ok(app.config_numeric('ai_match_max_confidence') = 0.85
               and app.config_numeric('ai_match_max_confidence') < app.config_numeric('auto_save_min_confidence'),
               '§7.3: batas confidence AI di bawah τ (saran AI selalu dikonfirmasi)');
select test.ok(app.config_numeric('ai_match_shortlist_min_similarity') = 0.2, '§7.2: ambang daftar pendek 0,2');

-- ---------------------------------------------------------------------------
-- Kunci tier berubah → confidence berubah (F-111)
-- ---------------------------------------------------------------------------
insert into public.product_alias (household_id, store_id, product_id, alias_text) values
  (test.hh('a'), '20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000200', 'MILO KCL 200');
insert into public.product_alias (store_id, product_id, alias_text, promoted_at) values
  ('20000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000500', 'MILO BESAR', now());

update app.config set value = '0.99' where key = 'match_conf_barcode';
update app.config set value = '0.97' where key = 'match_conf_alias_household';
update app.config set value = '0.93' where key = 'match_conf_alias_global';
update app.config set value = '0.65' where key = 'match_conf_alias_group';
update app.config set value = '0.80' where key = 'fuzzy_max_confidence';

create temp table m as
select x from jsonb_array_elements(app.match_products(test.hh('a'), '20000000-0000-0000-0000-000000000002', '[
  {"key": 1, "raw_text": "apa saja", "barcode": "8992696404441"},
  {"key": 2, "raw_text": "MILO KCL 200"},
  {"key": 3, "raw_text": "INDOMIE GRG 85G"},
  {"key": 4, "raw_text": "MILO BESAR"},
  {"key": 5, "raw_text": "milo original 500 g"}]')) x;
select test.ok((select (x ->> 'confidence')::numeric = 0.99 from m where x ->> 'key' = '1'), 'tier 1 membaca match_conf_barcode');
select test.ok((select (x ->> 'confidence')::numeric = 0.97 from m where x ->> 'key' = '2'), 'tier 2 household membaca config');
select test.ok((select (x ->> 'confidence')::numeric = 0.93 from m where x ->> 'key' = '3'), 'tier 2 global membaca config');
select test.ok((select (x ->> 'confidence')::numeric = 0.65 and x ->> 'tier' = 'alias' from m where x ->> 'key' = '4'),
               'tier 2b membaca config');
select test.ok((select x ->> 'tier' = 'fuzzy' and (x ->> 'confidence')::numeric = 0.80
                       and not exists (select 1 from jsonb_array_elements(x -> 'candidates') c
                                        where (c ->> 'confidence')::numeric > 0.80)
                  from m where x ->> 'key' = '5'), 'F-111: tier 3 = min(similarity, fuzzy_max_confidence)');
update app.config set value = '1.00' where key = 'fuzzy_max_confidence';

-- ---------------------------------------------------------------------------
-- app.ai_match_shortlist (§7.2)
-- ---------------------------------------------------------------------------
-- Produk privat A (dibeli di Alfamart) dan B (nama hampir sama).
insert into public.product (id, household_id, name, variant, content_size, content_unit, pack_count)
values ('7a000000-0000-0000-0000-000000000001', test.hh('a'), 'Kopi Kapal Ani', 'sachet', 25, 'g', 10),
       ('7b000000-0000-0000-0000-000000000001', test.hh('b'), 'Kopi Kapal Budi', 'sachet', 25, 'g', 10),
       ('7a000000-0000-0000-0000-000000000002', test.hh('a'), 'Roti Tawar Gandum Ani', null, 400, 'g', 1);
select test.login(test.uid('a'));
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date, effective_price, price_basis)
values (test.hh('a'), '7a000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
        'price_label', current_date, 15000, 'normal');
select test.logout();

create temp table s as
select x from jsonb_array_elements(app.ai_match_shortlist(test.hh('a'), '20000000-0000-0000-0000-000000000002', '[
  {"key": 1, "raw_text": "KOPI KPL SCH"},
  {"key": 2, "raw_text": "ROTI SR"},
  {"key": 3, "raw_text": "zzzz qqqq"},
  {"key": 4, "raw_text": "MILO"}]')) x;
select test.ok((select jsonb_array_length(app.ai_match_shortlist(test.hh('a'), null, '[]'))) = 0, 'masukan kosong → []');
select test.ok((select bool_and(x ? 'key' and x ? 'candidates') from s) and (select count(*) from s) = 4,
               'satu baris per item, urutan dan key dipertahankan');
select test.ok(exists (select 1 from s, jsonb_array_elements(x -> 'candidates') c
                        where x ->> 'key' = '1' and c ->> 'product_id' = '7a000000-0000-0000-0000-000000000001'
                          and c ->> 'size' = '10 × 25 g' and c ->> 'sale_mode' = 'unit' and c ? 'similarity'),
               'kandidat privat household sendiri, ukuran pack_count × content_size');
select test.ok(exists (select 1 from s, jsonb_array_elements(x -> 'candidates') c
                        where x ->> 'key' = '2' and c ->> 'product_id' = '7a000000-0000-0000-0000-000000000002'),
               'produk yang pernah dibeli di toko ini dengan kata pertama sama ikut walau similarity rendah');
select test.ok((select x -> 'candidates' = '[]' from s where x ->> 'key' = '3'), 'tanpa kandidat → [] (tidak dikirim ke model)');
select test.ok((select jsonb_array_length(x -> 'candidates') between 4 and 15
                       and (x #>> '{candidates,0,brand}') = 'Nestle' and (x #>> '{candidates,0,category}') is not null
                  from s where x ->> 'key' = '4'), 'brand dan kategori ikut, maks 15');
select test.ok((select jsonb_array_length(app.ai_match_shortlist(test.hh('a'), null, '[{"key": 1, "raw_text": "MILO"}]', 2) #> '{0,candidates}')) = 2,
               'p_limit membatasi jumlah kandidat');
select test.ok(not exists (select 1 from s, jsonb_array_elements(x -> 'candidates') c
                            where (c ->> 'similarity')::numeric < 0.2
                              and c ->> 'product_id' <> '7a000000-0000-0000-0000-000000000002'),
               'selain riwayat beli, similarity ≥ ai_match_shortlist_min_similarity');

-- Tidak pernah produk privat household lain (pola 98_rls_matrix): semua produk privat B
-- dicari dengan namanya sendiri sebagai household A, juga lewat riwayat beli di toko yang sama.
select test.login(test.uid('b'));
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date, effective_price, price_basis)
values (test.hh('b'), '7b000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
        'price_label', current_date, 12000, 'normal');
select test.logout();
select test.ok(not exists (
  select 1
    from public.product pb,
         jsonb_array_elements(app.ai_match_shortlist(test.hh('a'), '20000000-0000-0000-0000-000000000002',
                                jsonb_build_array(jsonb_build_object('key', 1, 'raw_text', pb.name)), 50)) r,
         jsonb_array_elements(r -> 'candidates') c
   where pb.household_id = test.hh('b')
     and (c ->> 'product_id')::uuid in (select id from public.product where household_id is distinct from test.hh('a')
                                                                          and household_id is not null)),
  '§7.2: tidak pernah mengembalikan produk privat household lain');
update public.product set status = 'archived' where id = '7a000000-0000-0000-0000-000000000001';
select test.ok(not exists (select 1 from jsonb_array_elements(app.ai_match_shortlist(test.hh('a'), null,
                             '[{"key": 1, "raw_text": "KOPI KAPAL ANI"}]') #> '{0,candidates}') c
                            where c ->> 'product_id' = '7a000000-0000-0000-0000-000000000001'),
               'hanya produk active');

-- Hak akses: hanya service_role.
select test.login(test.uid('a'));
select test.expect_code($$select app.ai_match_shortlist(test.hh('a'), null, '[]')$$, '42501',
                        'authenticated tidak bisa memanggil ai_match_shortlist');
select test.logout();

-- ---------------------------------------------------------------------------
-- db/scripts/calibration_report.sql berjalan (baca saja) di skema terbaru
-- ---------------------------------------------------------------------------
\ir ../../scripts/calibration_report.sql
select test.ok(true, '§8.2: calibration_report.sql berjalan tanpa error');
