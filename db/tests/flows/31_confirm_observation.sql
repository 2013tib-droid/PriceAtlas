-- 31 · confirm_capture_items + update_capture_item (§4.2, §5.7, D-26/27/41, Q-19, D-06/29).
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- Label harga di sesi belanja AEON BSD: 4 item.
insert into public.shopping_session (id, household_id, branch_id, started_by)
values ('5e000000-0000-0000-0000-000000000001', test.hh('a'), '30000000-0000-0000-0000-000000000001', test.uid('a'));
insert into public.capture (id, household_id, kind, shopping_session_id)
values ('ca000000-0000-0000-0000-000000000001', test.hh('a'), 'price_label', '5e000000-0000-0000-0000-000000000001');
update public.capture set status = 'processing' where id = 'ca000000-0000-0000-0000-000000000001';
update public.capture set status = 'needs_confirmation' where id = 'ca000000-0000-0000-0000-000000000001';
insert into public.capture_item (id, capture_id, household_id, position, raw_text, transaction_date, suggested_product_id,
                                 match_tier, match_confidence, normal_price, promo_price, promo_valid_from, promo_valid_until,
                                 member_price, member_program_id) values
  -- 1: promo sudah berakhir kemarin → normal
  ('c1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', test.hh('a'), 1, 'MILO 200G',
   current_date, '70000000-0000-0000-0000-000000000200', 'fuzzy', 0.7, 20000, 17000, current_date - 10, current_date - 1, null, null),
  -- 2: promo aktif → promo
  ('c1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001', test.hh('a'), 2, 'MILO 500G',
   current_date, '70000000-0000-0000-0000-000000000500', 'alias', 0.95, 47000, 43000, current_date - 1, current_date + 5, null, null),
  -- 3: harga member AEON (belum member) → normal; setelah member → member
  ('c1000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000001', test.hh('a'), 3, 'MILO 3IN1',
   current_date, '70000000-0000-0000-0000-000000000310', 'fuzzy', 0.6, 22000, null, null, null, 19000, '40000000-0000-0000-0000-000000000001'),
  -- 4: hanya harga member, tidak berlaku → NO_APPLICABLE_PRICE
  ('c1000000-0000-0000-0000-000000000004', 'ca000000-0000-0000-0000-000000000001', test.hh('a'), 4, 'MILO UHT',
   current_date, '70000000-0000-0000-0000-000000000180', 'fuzzy', 0.6, null, null, null, null, 5000, '40000000-0000-0000-0000-000000000001');

select test.login(test.uid('a'));

-- Pratinjau R16 (dihitung live, D-26/D-27)
select test.ok((select bool_and(case x ->> 'id'
                  when 'c1000000-0000-0000-0000-000000000001' then x #>> '{computed,price_basis}' = 'normal' and (x #>> '{computed,effective_price}')::numeric = 20000
                  when 'c1000000-0000-0000-0000-000000000002' then x #>> '{computed,price_basis}' = 'promo'  and (x #>> '{computed,effective_price}')::numeric = 43000
                  when 'c1000000-0000-0000-0000-000000000003' then x #>> '{computed,price_basis}' = 'normal' and not (x #>> '{computed,member_eligible}')::boolean
                  when 'c1000000-0000-0000-0000-000000000004' then x #>> '{computed,reason}' = 'no_applicable_price'
                end) from public.get_capture_items('ca000000-0000-0000-0000-000000000001') x),
               'D-26/D-27: pratinjau promo berakhir, promo aktif, member belum berlaku, tanpa harga');
select public.set_program_membership('40000000-0000-0000-0000-000000000001', true);
select test.ok((select x #>> '{computed,price_basis}' = 'member' and (x #>> '{computed,effective_price}')::numeric = 19000
                  from public.get_capture_items('ca000000-0000-0000-0000-000000000001') x
                 where x ->> 'id' = 'c1000000-0000-0000-0000-000000000003'),
               'S-11 "Saya member": pratinjau R16 berubah untuk item pending');
select public.set_program_membership('40000000-0000-0000-0000-000000000001', false);
select test.expect_code($$select public.set_program_membership('40000000-0000-0000-0000-000000000003', true)$$,
                        'INVALID_STATE', 'W16: program discontinued tidak bisa diikuti');

-- W18 update_capture_item
select test.expect_code($$select public.update_capture_item('c1000000-0000-0000-0000-000000000001', '{"normal_price": 1}', now() - interval '1 day')$$,
                        'STALE_WRITE', 'W18: konkurensi optimistik');
select test.expect_code(format($$select public.update_capture_item('c1000000-0000-0000-0000-000000000001', '{"extra": {"diskon": 1}}', %L)$$,
                               (select updated_at from public.capture_item where id = 'c1000000-0000-0000-0000-000000000001')),
                        'INVALID_EXTRA', 'W18: extra di luar kontrak');
select test.expect_code(format($$select public.update_capture_item('c1000000-0000-0000-0000-000000000001', '{"status": "accepted"}', %L)$$,
                               (select updated_at from public.capture_item where id = 'c1000000-0000-0000-0000-000000000001')),
                        'INVALID_INPUT', 'W18: kunci yang tidak diizinkan ditolak');
select test.ok((select (x ->> 'normal_price')::numeric = 19800 and x #>> '{computed,effective_price}' = '19800.00'
                  from public.update_capture_item('c1000000-0000-0000-0000-000000000001', '{"normal_price": 19800}',
                         (select updated_at from public.capture_item where id = 'c1000000-0000-0000-0000-000000000001')) x),
               'W18: edit harga → pratinjau ikut berubah');

-- Simpan sebagian
create temp table s1 as
select public.confirm_capture_items('ca000000-0000-0000-0000-000000000001', '[
  {"item_id": "c1000000-0000-0000-0000-000000000001", "action": "accept"},
  {"item_id": "c1000000-0000-0000-0000-000000000003", "action": "accept"}]') as r;
select test.ok((select jsonb_array_length(r -> 'saved') = 2 and (r ->> 'remaining_pending')::int = 2 from s1),
               'simpan sebagian: 2 tersimpan, 2 pending');
select test.ok((select status = 'needs_confirmation' from public.capture where id = 'ca000000-0000-0000-0000-000000000001'),
               'capture tetap needs_confirmation selama ada item pending');
select test.ok((select store_id = '20000000-0000-0000-0000-000000000001' and branch_id = '30000000-0000-0000-0000-000000000001'
                       and source_type = 'price_label' and match_outcome = 'confirmed' and effective_price = 19800
                       and visibility = 'private'
                  from public.price_record where id = (select price_record_id from public.capture_item where id = 'c1000000-0000-0000-0000-000000000001')),
               '§4.2: lokasi dari sesi, outcome confirmed, harga hasil edit');
select test.ok((select price_basis = 'normal' and effective_price = 22000 and member_price = 19000
                       and extra -> 'member_eligible' = 'false'
                  from public.price_record where id = (select price_record_id from public.capture_item where id = 'c1000000-0000-0000-0000-000000000003')),
               'D-27: harga member tidak dihitung (bukan member), snapshot member_eligible=false (F-11)');

-- D-41: menjadi member setelah simpan tidak mengubah record
select public.set_program_membership('40000000-0000-0000-0000-000000000001', true);
select test.ok((select price_basis = 'normal' and effective_price = 22000
                  from public.price_record where id = (select price_record_id from public.capture_item where id = 'c1000000-0000-0000-0000-000000000003')),
               'D-41: daftar member setelah simpan tidak mengubah record lama');

-- Item 4 sekarang berlaku (member), item 2 ditolak
select test.ok((select x #>> '{computed,price_basis}' = 'member' from public.get_capture_items('ca000000-0000-0000-0000-000000000001') x
                 where x ->> 'id' = 'c1000000-0000-0000-0000-000000000004'), 'pratinjau item 4 kini member');
select public.confirm_capture_items('ca000000-0000-0000-0000-000000000001', '[
  {"item_id": "c1000000-0000-0000-0000-000000000002", "action": "reject"},
  {"item_id": "c1000000-0000-0000-0000-000000000004", "action": "accept", "product_id": "70000000-0000-0000-0000-000000000180"}]');
select test.ok((select status = 'done' from public.capture where id = 'ca000000-0000-0000-0000-000000000001'),
               'semua item diputuskan → capture done');
select test.ok((select status = 'rejected' and decided_at is not null and price_record_id is null
                  from public.capture_item where id = 'c1000000-0000-0000-0000-000000000002'),
               'reject → item rejected tanpa record');
select test.ok((select price_basis = 'member' and member_program_id = '40000000-0000-0000-0000-000000000001'
                       and extra -> 'member_eligible' = 'true'
                  from public.price_record where id = (select price_record_id from public.capture_item where id = 'c1000000-0000-0000-0000-000000000004')),
               'D-27: member terdaftar → harga member dihitung');
select test.ok((select count(*) = 3 from public.product_alias where household_id = test.hh('a')
                   and store_id = '20000000-0000-0000-0000-000000000001'),
               'alias household dari raw_text label untuk setiap item yang diterima');

-- Idempoten
select test.ok((select jsonb_array_length(r -> 'saved') = 3
                  from public.confirm_capture_items('ca000000-0000-0000-0000-000000000001', '[
                    {"item_id": "c1000000-0000-0000-0000-000000000001", "action": "accept"},
                    {"item_id": "c1000000-0000-0000-0000-000000000002", "action": "accept"},
                    {"item_id": "c1000000-0000-0000-0000-000000000003", "action": "accept"},
                    {"item_id": "c1000000-0000-0000-0000-000000000004", "action": "accept"}]') r)
               and (select count(*) = 3 from public.price_record where capture_id = 'ca000000-0000-0000-0000-000000000001'),
               '§4.2: replay idempoten (item accepted dikembalikan, rejected diabaikan)');
select test.expect_code(format($$select public.update_capture_item('c1000000-0000-0000-0000-000000000001', '{"normal_price": 1}', %L)$$,
                               (select updated_at from public.capture_item where id = 'c1000000-0000-0000-0000-000000000001')),
                        'INVALID_STATE', 'W18: item yang sudah diputuskan tidak bisa diedit');

-- ---------------------------------------------------------------------------
-- STORE_REQUIRED, NO_APPLICABLE_PRICE, seri harga, marketplace seller
-- ---------------------------------------------------------------------------
select test.logout();
insert into public.capture (id, household_id, kind) values
  ('ca000000-0000-0000-0000-000000000002', test.hh('a'), 'price_label'),
  ('ca000000-0000-0000-0000-000000000003', test.hh('a'), 'marketplace');
update public.capture set status = 'processing' where id in ('ca000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000003');
update public.capture set status = 'needs_confirmation' where id in ('ca000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000003');
insert into public.capture_item (id, capture_id, household_id, position, raw_text, transaction_date, suggested_product_id,
                                 normal_price, member_price, member_program_id, store_id, seller_name, seller_ref, extra) values
  ('c2000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000002', test.hh('a'), 1, 'MILO', current_date,
   '70000000-0000-0000-0000-000000000200', 19000, null, null, null, null, null, '{}'),
  ('c2000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000002', test.hh('a'), 2, 'MILO SAMA', current_date,
   '70000000-0000-0000-0000-000000000200', 18000, 18000, '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, null, '{}'),
  ('c2000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000002', test.hh('a'), 3, 'MILO X', current_date,
   '70000000-0000-0000-0000-000000000200', null, 15000, '40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', null, null, '{}'),
  ('c3000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000003', test.hh('a'), 1, 'Milo 1kg', current_date,
   '70000000-0000-0000-0000-000000000500', 89000, null, null, '20000000-0000-0000-0000-000000000004', 'Toko Susu Jaya', 'susu-jaya',
   '{"listing_title": "MILO ACTIV-GO 1KG PROMO", "shipping_fee": 9000}'),
  ('c3000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000003', test.hh('a'), 2, 'Milo 200', current_date,
   '70000000-0000-0000-0000-000000000200', 19000, null, null, '20000000-0000-0000-0000-000000000004', 'Nestle Official', 'nestle-official', '{}');
select test.login(test.uid('a'));
select test.expect_code($$select public.confirm_capture_items('ca000000-0000-0000-0000-000000000002',
                          '[{"item_id": "c2000000-0000-0000-0000-000000000001", "action": "accept"}]')$$,
                        'STORE_REQUIRED', 'D-28: observasi tanpa toko ditolak');
select test.expect_code($$select public.confirm_capture_items('ca000000-0000-0000-0000-000000000002',
                          '[{"item_id": "c2000000-0000-0000-0000-000000000003", "action": "accept"}]')$$,
                        'NO_APPLICABLE_PRICE', 'Q-19: hanya harga member yang tidak berlaku ditolak');
select public.confirm_capture_items('ca000000-0000-0000-0000-000000000002',
                                    '[{"item_id": "c2000000-0000-0000-0000-000000000002", "action": "accept"}]');
select test.ok((select price_basis = 'normal' and effective_price = 18000
                  from public.price_record where id = (select price_record_id from public.capture_item where id = 'c2000000-0000-0000-0000-000000000002')),
               'Q-19: seri normal = member → label normal');

select public.confirm_capture_items('ca000000-0000-0000-0000-000000000003', '[
  {"item_id": "c3000000-0000-0000-0000-000000000001", "action": "accept"},
  {"item_id": "c3000000-0000-0000-0000-000000000002", "action": "accept"}]');
select test.ok((select b.household_id = test.hh('a') and b.kind = 'seller' and b.name = 'Toko Susu Jaya' and b.external_ref = 'susu-jaya'
                       and pr.source_type = 'marketplace' and (pr.extra ->> 'shipping_fee')::numeric = 9000 and pr.effective_price = 89000
                  from public.price_record pr join public.branch b on b.id = pr.branch_id
                 where pr.id = (select price_record_id from public.capture_item where id = 'c3000000-0000-0000-0000-000000000001')),
               'D-06/D-29: seller baru menjadi branch privat; ongkir di extra, tidak mengubah harga (D-36)');
select test.ok((select branch_id = '30000000-0000-0000-0000-000000000005'
                  from public.price_record where id = (select price_record_id from public.capture_item where id = 'c3000000-0000-0000-0000-000000000002')),
               'seller global yang cocok (external_ref) dipakai');
select test.ok(exists (select 1 from public.product_alias where household_id = test.hh('a')
                        and store_id = '20000000-0000-0000-0000-000000000004' and normalized_text = 'milo activ-go 1kg promo'),
               'alias marketplace dari listing_title');
select test.logout();
