-- 20 · Turunan struk D-23 (F-05, D-63, Q-18): rumus, penjaga konsistensi, turunan ulang.
\ir ../lib/harness.sql
\ir ../lib/seed.sql

select test.login(test.uid('a'));
insert into public.receipt (id, household_id, store_id, branch_id, transaction_date, total_amount, status)
values ('90000000-0000-0000-0000-000000000001', test.hh('a'), '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', current_date - 1, 100000, 'draft');

-- line_no: 1 Milo 2×19.500 | 2 diskon member | 3 Milo 3in1 | 4 jeruk timbang | 5 diskon jeruk
--          6 Indomie 3×5.000 | 7 void 1 Indomie | 8 Indomie 1×5.000 | 9 void penuh
--          10 hadiah: 1×5.000 diskon −5.000 | 11 diskon hadiah
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount, applies_to_line_id) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', test.hh('a'), 1,  'product',  'MILO ORI 500G',  2,     19500, 39000, null),
  ('91000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', test.hh('a'), 3,  'product',  'MILO 3IN1',      1,     21000, 21000, null),
  ('91000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000001', test.hh('a'), 4,  'product',  'JERUK MEDAN',    0.535, 45000, 24075, null),
  ('91000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000001', test.hh('a'), 5,  'discount', 'DISC JERUK',     null,  null,  -2075, '91000000-0000-0000-0000-000000000004'),
  ('91000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000001', test.hh('a'), 6,  'product',  'INDOMIE GRG',    3,     5000,  15000, null),
  ('91000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000001', test.hh('a'), 7,  'void',     'VOID INDOMIE',   null,  null,  -5000, '91000000-0000-0000-0000-000000000006'),
  ('91000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000001', test.hh('a'), 8,  'product',  'INDOMIE GRG',    1,     5000,  5000,  null),
  ('91000000-0000-0000-0000-000000000009', '90000000-0000-0000-0000-000000000001', test.hh('a'), 9,  'void',     'VOID',           1,     null,  -5000, '91000000-0000-0000-0000-000000000008'),
  ('91000000-0000-0000-0000-000000000010', '90000000-0000-0000-0000-000000000001', test.hh('a'), 10, 'product',  'HADIAH MILO',    1,     5000,  5000,  null),
  ('91000000-0000-0000-0000-000000000011', '90000000-0000-0000-0000-000000000001', test.hh('a'), 11, 'discount', 'GRATIS',         null,  null,  -5000, '91000000-0000-0000-0000-000000000010');

-- Satuan biasa tanpa diskon
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000500', 'confirmed');
select test.ok((select quantity = 2 and normal_price = 19500 and effective_price = 19500 and price_basis = 'normal'
                       and promo_price is null and unit_price = 39 and transaction_date = current_date - 1
                       and branch_id = '30000000-0000-0000-0000-000000000001'
                  from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001'),
               'unit: 2 × 19.500 → q 2, normal = efektif 19.500, Rp39/g');

-- Multipack
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000310', 'confirmed');
select test.ok((select unit_price = 60 from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000003'),
               'multipack 10 × 35 g, Rp21.000 → Rp60/g');

-- Timbang + diskon
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-0000000000f1', 'confirmed');
select test.ok((select quantity = 1 and actual_weight = 0.535 and normal_price = 45000 and effective_price = 41121.50
                       and price_basis = 'promo' and promo_price = 41121.50
                  from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000004'),
               'timbang: (24.075 − 2.075) / 0,535 kg = 41.121,50 promo');

-- Void sebagian
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000085', 'confirmed');
select test.ok((select quantity = 2 and effective_price = 5000 and price_basis = 'normal'
                  from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000006'),
               'void sebagian: 3 − 1 → q 2, efektif 5.000');

-- Void penuh dan neto <= 0: tanpa record (Q-18)
select test.ok(app.upsert_receipt_record('91000000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000085', 'confirmed') is null
               and not exists (select 1 from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000008'),
               'Q-18: void penuh → tanpa record');
select test.ok(app.upsert_receipt_record('91000000-0000-0000-0000-000000000010', '70000000-0000-0000-0000-000000000200', 'confirmed') is null
               and not exists (select 1 from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000010'),
               'Q-18: neto 0 (hadiah) → tanpa record');
select test.ok(app.upsert_receipt_record('91000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000200', 'confirmed') is null,
               'baris diskon tidak pernah menjadi record');

-- Idempoten
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000500', 'confirmed');
select test.ok((select count(*) from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001') = 1,
               'upsert idempoten (1 record per baris)');

-- ---------------------------------------------------------------------------
-- Penjaga konsistensi: angka record struk tidak bisa diubah langsung
-- ---------------------------------------------------------------------------
select test.expect_code($$update public.price_record set effective_price = 1000
                          where receipt_line_id = '91000000-0000-0000-0000-000000000001'$$,
                        'RECEIPT_DERIVED_FIELD', 'D-23: ubah effective_price langsung ditolak');
select test.expect_code($$update public.price_record set transaction_date = current_date - 30
                          where receipt_line_id = '91000000-0000-0000-0000-000000000001'$$,
                        'RECEIPT_DERIVED_FIELD', 'D-23: ubah tanggal record struk langsung ditolak');
select test.expect_code($$update public.price_record set price_basis = 'member', member_price = 1,
                                 member_program_id = '40000000-0000-0000-0000-000000000001'
                          where receipt_line_id = '91000000-0000-0000-0000-000000000001'$$,
                        'RECEIPT_DERIVED_FIELD', 'D-63: struk tidak pernah menghasilkan harga member');
select test.expect_code($$insert into public.price_record (household_id, product_id, store_id, source_type, receipt_line_id,
                             transaction_date, effective_price, price_basis)
                         values (test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001',
                                 'receipt', '91000000-0000-0000-0000-000000000003', current_date, 1, 'normal')$$,
                        'RECEIPT_DERIVED_FIELD', 'D-23: insert record struk dengan angka berbeda ditolak');
update public.price_record set is_bundle = true, extra = '{"note": "beli 2"}', status = 'void'
 where receipt_line_id = '91000000-0000-0000-0000-000000000003';
update public.price_record set is_bundle = false, status = 'active'
 where receipt_line_id = '91000000-0000-0000-0000-000000000003';
select test.ok(true, 'kolom bebas (is_bundle, extra, status) boleh diubah langsung');

-- Ganti produk: angka dihitung ulang, unit_price ikut produk baru
update public.price_record set product_id = '70000000-0000-0000-0000-000000000200', match_outcome = 'corrected'
 where receipt_line_id = '91000000-0000-0000-0000-000000000001';
select test.ok((select unit_price = 97.5 from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001'),
               'ganti produk record struk → unit_price produk baru (19.500 / 200 g)');
update public.price_record set product_id = '70000000-0000-0000-0000-000000000500'
 where receipt_line_id = '91000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Turunan ulang dari receipt_line
-- ---------------------------------------------------------------------------
update public.receipt_line set quantity = 3, line_amount = 58500 where id = '91000000-0000-0000-0000-000000000001';
select test.ok((select quantity = 3 and effective_price = 19500 and product_id = '70000000-0000-0000-0000-000000000500'
                  from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001'),
               'ubah receipt_line → record terbentuk ulang, produk pilihan user tetap');

insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, line_amount, applies_to_line_id)
values ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', test.hh('a'), 2, 'discount',
        'DISC MEMBER AEON', -3000, '91000000-0000-0000-0000-000000000001');
select test.ok((select effective_price = 18500 and price_basis = 'promo' and promo_price = 18500
                  from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001'),
               'diskon baru menempel → (58.500 − 3.000) / 3 = 18.500 promo');
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000500', 'confirmed');
select test.ok((select extra -> 'member_hint' = '{"text": "DISC MEMBER AEON", "program_id": "40000000-0000-0000-0000-000000000001"}'::jsonb
                       and price_basis = 'promo'
                  from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001'),
               'D-63: diskon bertanda member → extra.member_hint, basis tetap promo');

delete from public.receipt_line where id = '91000000-0000-0000-0000-000000000002';
select test.ok((select effective_price = 19500 and price_basis = 'normal'
                  from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001'),
               'hapus diskon → record kembali normal');

update public.receipt_line set line_amount = -15000, quantity = 3 where id = '91000000-0000-0000-0000-000000000007';
select test.ok(not exists (select 1 from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000006'),
               'Q-18: void diperbesar sampai penuh → record dihapus');
select test.ok((select count(*) from public.audit_log where entity_type = 'price_record' and action = 'delete') = 1,
               'penghapusan record oleh turunan tercatat di audit');

update public.receipt_line set line_type = 'non_product' where id = '91000000-0000-0000-0000-000000000003';
select test.ok(not exists (select 1 from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000003'),
               'line_type product → non_product: record dihapus');

-- Header tetap mengalir (trigger lama) dan lolos penjaga
update public.receipt set store_id = '20000000-0000-0000-0000-000000000002', branch_id = null,
                          transaction_date = current_date - 3
 where id = '90000000-0000-0000-0000-000000000001';
select test.ok((select bool_and(store_id = '20000000-0000-0000-0000-000000000002' and branch_id is null
                                and transaction_date = current_date - 3)
                  from public.price_record where source_type = 'receipt'),
               'koreksi header struk mengalir ke semua record struk');
select test.ok((select count(*) from public.audit_log where entity_type = 'receipt_line') >= 3,
               'koreksi receipt_line tercatat di audit');
select test.logout();

-- Pekerjaan sistem: merge memindahkan record struk; recompute tetap lolos penjaga
update public.product set content_size = 250 where id = '70000000-0000-0000-0000-000000000500';
select app.recompute_unit_prices('70000000-0000-0000-0000-000000000500');
select test.ok((select unit_price = 78 from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001'),
               'recompute_unit_prices tetap jalan untuk record struk');
