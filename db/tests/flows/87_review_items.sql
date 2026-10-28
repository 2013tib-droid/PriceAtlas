-- 87 · Item tinjauan Tahap 6 (docs/08 §11.1 #6, §11.2; 6b M4): read_member_* + W18 pemetaan ulang
--      member (Q-77), R18 item_status / thumbnail_path / vs_best_pct tanpa record sesi (Q-80, Q-81,
--      Q-97), R20 source_text (Q-87).
\ir ../lib/harness.sql
\ir ../lib/seed.sql

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

-- ---------------------------------------------------------------------------
-- Q-77: apply_extraction menyimpan harga member yang terbaca
-- ---------------------------------------------------------------------------
select app.apply_extraction('cd000000-0000-0000-0000-000000000001',
  test.new_capture('cd000000-0000-0000-0000-000000000001', 'price_label', repeat('a', 64)),
  '{"kind": "price_label", "items": [
     {"raw_text": "MILO 3IN1", "normal_price": 23000, "member_price": 20000, "member_program_name": "Alfagift",
      "match": {"product_id": "70000000-0000-0000-0000-000000000310", "tier": "alias", "confidence": 0.5}},
     {"raw_text": "MILO UHT", "normal_price": 6000, "member_price": 5000,
      "match": {"product_id": "70000000-0000-0000-0000-000000000180", "tier": "alias", "confidence": 0.5}},
     {"raw_text": "MILO 200", "normal_price": 19500,
      "match": {"product_id": "70000000-0000-0000-0000-000000000200", "tier": "alias", "confidence": 0.5}}]}');
select test.ok((select member_price is null and member_program_id is null
                       and extra ->> 'member_note' = 'Alfagift 20000'
                       and read_member_price = 20000 and read_member_program_name = 'Alfagift'
                  from public.capture_item where capture_id = 'cd000000-0000-0000-0000-000000000001' and position = 1),
               'Q-77: toko belum diketahui → member_note + read_member_* tersimpan');
select test.ok((select read_member_price = 5000 and read_member_program_name is null
                  from public.capture_item where capture_id = 'cd000000-0000-0000-0000-000000000001' and position = 2)
               and (select read_member_price is null
                      from public.capture_item where capture_id = 'cd000000-0000-0000-0000-000000000001' and position = 3),
               'read_member_* kosong jika tidak ada harga member');

create temp table ids as
select position, id, updated_at from public.capture_item where capture_id = 'cd000000-0000-0000-0000-000000000001';
grant select on ids to authenticated;

-- ---------------------------------------------------------------------------
-- W18: pemetaan ulang saat lokasi berubah
-- ---------------------------------------------------------------------------
select test.login(test.uid('a'));
select test.expect_code($$update public.capture_item set read_member_price = 1
                           where capture_id = 'cd000000-0000-0000-0000-000000000001'$$,
                        '42501', 'read_member_* tidak bisa diubah user');

select public.update_capture_item((select id from ids where position = 1),
  '{"store_id": "20000000-0000-0000-0000-000000000002"}', (select updated_at from ids where position = 1));
select test.ok((select member_price = 20000 and member_program_id = '40000000-0000-0000-0000-000000000002'
                       and not extra ? 'member_note'
                  from public.capture_item where id = (select id from ids where position = 1)),
               'W18: pilih Alfamart → Alfagift dipetakan, member_note dihapus (F-57)');

select public.update_capture_item((select id from ids where position = 1),
  '{"store_id": "20000000-0000-0000-0000-000000000001"}',
  (select updated_at from public.capture_item where id = (select id from ids where position = 1)));
select test.ok((select member_price is null and member_program_id is null and extra ->> 'member_note' = 'Alfagift 20000'
                  from public.capture_item where id = (select id from ids where position = 1)),
               'W18: pindah ke AEON (tanpa Alfagift) → kembali ke member_note');

select public.update_capture_item((select id from ids where position = 2),
  '{"store_id": "20000000-0000-0000-0000-000000000001", "branch_id": "30000000-0000-0000-0000-000000000001"}',
  (select updated_at from ids where position = 2));
select test.ok((select member_price = 5000 and member_program_id = '40000000-0000-0000-0000-000000000001'
                       and branch_id = '30000000-0000-0000-0000-000000000001'
                  from public.capture_item where id = (select id from ids where position = 2)),
               'W18: tanpa nama program + toko punya satu program aktif → program itu');

select public.update_capture_item((select id from ids where position = 1),
  '{"store_id": "20000000-0000-0000-0000-000000000002", "member_price": 19000,
    "member_program_id": "40000000-0000-0000-0000-000000000002"}',
  (select updated_at from public.capture_item where id = (select id from ids where position = 1)));
select test.ok((select member_price = 19000 from public.capture_item where id = (select id from ids where position = 1)),
               'W18: harga member dari user di patch yang sama tidak ditimpa');

select public.update_capture_item((select id from ids where position = 3),
  '{"store_id": "20000000-0000-0000-0000-000000000002"}', (select updated_at from ids where position = 3));
select test.ok((select member_price is null and member_program_id is null and not extra ? 'member_note'
                  from public.capture_item where id = (select id from ids where position = 3)),
               'W18: tanpa harga member terbaca → tidak ada pemetaan');
select test.logout();

-- ---------------------------------------------------------------------------
-- R18: item_status, thumbnail_path, vs_best_pct tanpa record sesi
-- ---------------------------------------------------------------------------
-- Histori lama Milo 200 g: Rp19.500 (97,5/g). Sesi ini mencatat Rp18.000 (90/g).
insert into public.price_record (household_id, product_id, store_id, branch_id, source_type, transaction_date,
                                 normal_price, effective_price, price_basis)
values (test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'price_label', current_date - 5, 19500, 19500, 'normal');
insert into public.shopping_session (id, household_id, branch_id)
values ('5e000000-0000-0000-0000-000000000087', test.hh('a'), '30000000-0000-0000-0000-000000000002');
select app.apply_extraction('cd000000-0000-0000-0000-000000000002',
  test.new_capture('cd000000-0000-0000-0000-000000000002', 'price_label', repeat('b', 64), '5e000000-0000-0000-0000-000000000087'),
  '{"kind": "price_label", "items": [
     {"raw_text": "MILO ORI 200G", "normal_price": 18000, "field_confidence": {"price": 0.99}, "image_position": 1,
      "match": {"product_id": "70000000-0000-0000-0000-000000000200", "tier": "alias", "confidence": 0.99}},
     {"raw_text": "MILO 500G", "normal_price": 50000,
      "match": {"product_id": "70000000-0000-0000-0000-000000000500", "tier": "fuzzy", "confidence": 0.5}}]}');
select app.process_summary_queue();

select test.login(test.uid('a'));
create temp table r18 as select l from public.get_active_session() s, jsonb_array_elements(s -> 'labels') l;
select test.ok((select (l ->> 'vs_best_pct')::numeric = -7.7 and l ->> 'item_status' = 'accepted'
                  from r18 where l #>> '{product,id}' = '70000000-0000-0000-0000-000000000200'),
               'R18: record sesi tidak dibandingkan dengan dirinya sendiri (90/g vs 97,5/g lama → −7,7 %)');
select test.ok((select (sm.best_90d_unit_price)::numeric = 90 from public.price_summary sm
                 where sm.product_id = '70000000-0000-0000-0000-000000000200'),
               'ringkasan tetap memuat record sesi (hanya R18 yang mengecualikannya)');
select test.ok((select l ->> 'item_status' = 'pending' and l -> 'vs_best_pct' = 'null'
                  from r18 where l #>> '{product,id}' = '70000000-0000-0000-0000-000000000500'),
               'R18: item pending; tanpa histori lain di luar sesi → vs_best_pct null');
select test.ok((select count(*) = 2 and bool_and(l ->> 'thumbnail_path' = test.hh('a') || '/cd000000-0000-0000-0000-000000000002/1.jpg')
                  from r18),
               'R18: thumbnail_path = storage_path gambar posisi item');
select test.logout();

update public.capture_image set purged_at = now() where capture_id = 'cd000000-0000-0000-0000-000000000002';
select test.login(test.uid('a'));
select test.ok((select bool_and(l -> 'thumbnail_path' = 'null')
                  from public.get_active_session() s, jsonb_array_elements(s -> 'labels') l),
               'R18: gambar sudah di-purge → thumbnail_path null');
select test.logout();

-- Capture sesi tanpa item (masih diproses): item_status null.
insert into public.capture (id, household_id, kind, shopping_session_id)
values ('cd000000-0000-0000-0000-000000000003', test.hh('a'), 'price_label', '5e000000-0000-0000-0000-000000000087');
select test.login(test.uid('a'));
select test.ok((select l -> 'item_status' = 'null' and l -> 'item_id' = 'null' and l -> 'thumbnail_path' = 'null'
                  from public.get_active_session() s, jsonb_array_elements(s -> 'labels') l
                 where l ->> 'capture_id' = 'cd000000-0000-0000-0000-000000000003'),
               'R18: label tanpa item → item_status null');

-- Household lain tidak melihat sesi Ani.
select test.logout();
select test.login(test.uid('b'));
select test.ok(public.get_active_session() is null, 'R18: sesi household lain tidak terlihat');
select test.logout();

-- ---------------------------------------------------------------------------
-- R20 source_text
-- ---------------------------------------------------------------------------
select test.login(test.uid('a'));
select test.ok((select public.price_record_detail(i.price_record_id) ->> 'source_text' = 'MILO ORI 200G'
                  from public.capture_item i
                 where i.capture_id = 'cd000000-0000-0000-0000-000000000002' and i.position = 1),
               'R20: record label → teks label (capture_item.raw_text)');
select test.ok((select public.price_record_detail(pr.id) -> 'source_text' = 'null'
                  from public.price_record pr where pr.capture_id is null and pr.household_id = test.hh('a') limit 1),
               'R20: record manual tanpa sumber teks → null');
select test.logout();

insert into public.price_record (id, household_id, product_id, store_id, source_type, transaction_date,
                                 normal_price, effective_price, price_basis, extra)
values ('8d000000-0000-0000-0000-000000000001', test.hh('a'), '70000000-0000-0000-0000-000000000500',
        '20000000-0000-0000-0000-000000000004', 'marketplace', current_date, 45000, 45000, 'normal',
        '{"listing_title": "Milo Activ-Go 500g Kaleng Original"}');
select test.login(test.uid('a'));
select test.ok(public.price_record_detail('8d000000-0000-0000-0000-000000000001') ->> 'source_text'
                 = 'Milo Activ-Go 500g Kaleng Original',
               'R20: record marketplace → judul listing');
select test.logout();

-- Struk: teks baris struk.
insert into public.capture (id, household_id, kind) values ('cd000000-0000-0000-0000-000000000004', test.hh('a'), 'receipt');
insert into public.receipt (id, household_id, capture_id, store_id, transaction_date, currency, total_amount, status)
values ('7d000000-0000-0000-0000-000000000001', test.hh('a'), 'cd000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000001', current_date, 'IDR', 19500, 'draft');
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount)
values ('7e000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000001', test.hh('a'), 1, 'product',
        'MILO ACTIV GO 200G', 1, 19500, 19500);
select app.upsert_receipt_record('7e000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000200', 'confirmed');
select test.login(test.uid('a'));
select test.ok((select public.price_record_detail(pr.id) ->> 'source_text' = 'MILO ACTIV GO 200G'
                  from public.price_record pr where pr.receipt_line_id = '7e000000-0000-0000-0000-000000000001'),
               'R20: record struk → teks baris struk');
select test.logout();
