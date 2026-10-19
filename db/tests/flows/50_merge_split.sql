-- 50 · Merge (§4.4, F-01, D-30) dan split (§4.5, D-37), create_private_product (W8).
\ir ../lib/harness.sql
\ir ../lib/seed.sql

select test.login(test.uid('a'));

-- ---------------------------------------------------------------------------
-- W8 create_private_product
-- ---------------------------------------------------------------------------
create temp table p1 as
select public.create_private_product('{
  "id": "7a000000-0000-0000-0000-000000000001", "name": "Milo Kaleng Ani", "variant": "400 g",
  "brand": {"new": "nestle"}, "group": "same_as_name", "content_size": 400, "content_unit": "g",
  "barcodes": [{"code": "8992696404441", "code_type": "gtin"}, {"code": "77777777", "code_type": "gtin"}]}') as c;
select test.ok((select c #>> '{product,id}' = '7a000000-0000-0000-0000-000000000001' and (c #>> '{product,is_private}')::boolean
                       and c #>> '{product,brand_name}' = 'Nestle' from p1),
               'W8: produk privat dibuat, brand "nestle" memakai brand yang ada');
select test.ok((select household_id = test.hh('a') and name = 'Milo Kaleng Ani' from public.product_group
                 where id = (select product_group_id from public.product where id = '7a000000-0000-0000-0000-000000000001')),
               'W8: group same_as_name privat');
select test.ok((select count(*) = 2 and bool_and(household_id = test.hh('a')) from public.barcode_assignment
                 where product_id = '7a000000-0000-0000-0000-000000000001'),
               'W8: barcode privat (household dari produk)');
select public.create_private_product('{"id": "7a000000-0000-0000-0000-000000000001", "name": "lain"}');
select test.ok((select count(*) = 1 from public.product where household_id = test.hh('a')), 'W8: idempoten berdasarkan id');
select test.expect_code($$select public.create_private_product('{"name": "Tanpa Ukuran", "content_unit": "g"}')$$,
                        '23514', 'W8: produk kemasan wajib ukuran');
select test.expect_code($$select public.create_private_product('{"name": "Dobel", "content_size": 1, "content_unit": "g",
                          "barcodes": [{"code": "77777777", "code_type": "gtin"}]}')$$,
                        '23P01', 'W8: barcode tumpang tindih di household yang sama');
select public.create_private_product('{"id": "7a000000-0000-0000-0000-000000000002", "name": "Keripik Ani", "brand": {"new": "Bu Siti"},
                                       "group": {"new": "Keripik"}, "content_size": 100, "content_unit": "g",
                                       "barcodes": [{"code": "12345670", "code_type": "gtin"}]}');
select test.ok((select b.household_id = test.hh('a') from public.brand b join public.product p on p.brand_id = b.id
                 where p.id = '7a000000-0000-0000-0000-000000000002'),
               'D-29: brand baru dari user selalu privat');
select test.logout();

-- ---------------------------------------------------------------------------
-- F-01: merge privat → global tidak memindahkan barcode privat
-- ---------------------------------------------------------------------------
select test.login(test.uid('a'));
insert into public.price_record (id, household_id, product_id, store_id, source_type, transaction_date, effective_price, price_basis)
values ('8a000000-0000-0000-0000-000000000001', test.hh('a'), '7a000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', 'price_label', current_date, 38000, 'normal');
select test.ok((select p ->> 'can_merge' = 'true' and (p #>> '{counts,barcodes}')::int = 2
                       and (p #>> '{counts,barcodes_kept}')::int = 2 and (p #>> '{counts,price_records}')::int = 1
                       and (p ->> 'size_mismatch')::boolean
                  from public.merge_product_preview('7a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000500') p),
               'R19: pratinjau menyebut 2 barcode tetap tinggal (F-01) dan beda ukuran (T-9)');
select public.merge_product('7a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000500');
select test.ok(true, 'F-01: merge berhasil walau GTIN yang sama sudah ada di produk global (dulu gagal EXCLUDE)');
select test.ok((select count(*) = 2 and bool_and(household_id = test.hh('a') and product_id = '7a000000-0000-0000-0000-000000000001')
                  from public.barcode_assignment where code in ('8992696404441', '77777777') and household_id is not null),
               'F-01: barcode privat tetap di produk lama dan tetap privat');
select test.logout();
select test.ok((select count(*) = 0 from public.barcode_assignment where household_id is null and code = '77777777'),
               'F-01: tidak ada barcode privat yang menjadi global');
select test.login(test.uid('a'));
select test.ok(public.find_product_by_barcode('77777777') = '{"product_id": "70000000-0000-0000-0000-000000000500", "via_merge": true}',
               'F-01: matching barcode mengikuti merged_into_id');
select test.ok((select product_id = '70000000-0000-0000-0000-000000000500' and unit_price = 76
                  from public.price_record where id = '8a000000-0000-0000-0000-000000000001'),
               'merge memindahkan histori; unit_price dihitung ulang (38.000 / 500 g)');
select test.expect_code($$select public.merge_product('70000000-0000-0000-0000-000000000500', '70000000-0000-0000-0000-000000000200')$$,
                        '42501', 'D-30: user tidak bisa merge produk global (MERGE_FORBIDDEN → 42501)');
select test.ok((select p ->> 'reason' = 'already_merged'
                  from public.merge_product_preview('7a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000500') p),
               '§4.4: merge kedua dikenali sebagai sudah merged ke target yang sama');

-- Merge privat → privat memindahkan barcode
select public.create_private_product('{"id": "7a000000-0000-0000-0000-000000000003", "name": "Keripik Ani B", "content_size": 100, "content_unit": "g"}');
select public.merge_product('7a000000-0000-0000-0000-000000000002', '7a000000-0000-0000-0000-000000000003');
select test.ok((select product_id = '7a000000-0000-0000-0000-000000000003' from public.barcode_assignment where code = '12345670'),
               'merge privat → privat memindahkan barcode');
select test.logout();

-- ---------------------------------------------------------------------------
-- Split: move_price_records
-- ---------------------------------------------------------------------------
insert into public.price_record (id, household_id, product_id, store_id, source_type, transaction_date, effective_price, price_basis) values
  ('8a000000-0000-0000-0000-000000000011', test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', 'price_label', current_date - 1, 19000, 'normal'),
  ('8a000000-0000-0000-0000-000000000012', test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', 'price_label', current_date - 2, 19100, 'normal'),
  ('8b000000-0000-0000-0000-000000000011', test.hh('b'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', 'price_label', current_date - 1, 1, 'normal');
insert into public.receipt (id, household_id, store_id, transaction_date, total_amount, status)
values ('90000000-0000-0000-0000-000000000001', test.hh('a'), '20000000-0000-0000-0000-000000000002', current_date - 3, 19500, 'confirmed');
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount)
values ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', test.hh('a'), 1, 'product', 'MILO RTD', 1, 19500, 19500);
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000200', 'confirmed');
insert into public.product_alias (household_id, store_id, product_id, alias_text)
values (test.hh('a'), '20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000200', 'MILO RTD');

select test.login(test.uid('a'));
select test.expect_code($$select public.move_price_records(array['8a000000-0000-0000-0000-000000000011',
                                                                 '8b000000-0000-0000-0000-000000000011']::uuid[],
                                                           '70000000-0000-0000-0000-000000000180')$$,
                        'RECORDS_NOT_OWNED', 'D-37: record milik household lain → RECORDS_NOT_OWNED');
select test.ok((select product_id = '70000000-0000-0000-0000-000000000200' from public.price_record
                 where id = '8a000000-0000-0000-0000-000000000011'), 'penolakan tidak memindahkan apa pun');
select test.ok((select (r ->> 'moved_count')::int = 2
                  from public.move_price_records(
                    array['8a000000-0000-0000-0000-000000000011',
                          (select id::text from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001')]::uuid[],
                    '70000000-0000-0000-0000-000000000180',
                    '{"store_id": "20000000-0000-0000-0000-000000000002", "alias_text": "MILO RTD"}') r),
               'D-37: 2 record dipindah (termasuk record struk, D-23)');
select test.ok((select bool_and(product_id = '70000000-0000-0000-0000-000000000180' and match_outcome = 'corrected')
                  from public.price_record where id = '8a000000-0000-0000-0000-000000000011'
                     or receipt_line_id = '91000000-0000-0000-0000-000000000001'),
               'record pindah ke target, outcome corrected');
select test.ok((select product_id = '70000000-0000-0000-0000-000000000180' from public.product_alias
                 where household_id = test.hh('a') and normalized_text = 'milo rtd'),
               'alias household dialihkan ke target');
select test.ok((select (r ->> 'moved_count')::int = 0
                  from public.move_price_records(array['8a000000-0000-0000-0000-000000000011']::uuid[],
                                                 '70000000-0000-0000-0000-000000000180') r),
               '§4.5: idempoten (record yang sudah di target dilewati)');
select test.ok((select (r ->> 'target_product_id') = '70000000-0000-0000-0000-000000000500'
                  from public.move_price_records(array['8a000000-0000-0000-0000-000000000012']::uuid[],
                                                 '7a000000-0000-0000-0000-000000000001') r),
               'target yang sudah merged diikuti ke produk pengganti');
select test.expect_code($$select public.move_price_records(array['8a000000-0000-0000-0000-000000000012']::uuid[],
                                                           gen_random_uuid())$$,
                        'NOT_FOUND', 'target tidak terlihat → NOT_FOUND');
select test.logout();
