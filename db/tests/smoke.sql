-- Smoke test untuk db/schema.sql. Dijalankan oleh db/tests/run.sh.
-- Setiap blok gagal dengan exception jika invariant tidak terpenuhi.
\set ON_ERROR_STOP 1
\set QUIET 1

create schema test;
create function test.expect_error(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'GAGAL: % — seharusnya ditolak', p_label;
exception when others then
  if sqlerrm like 'GAGAL:%' then raise; end if;
  raise notice 'ok  : % (ditolak: %)', p_label, sqlerrm;
end $$;
create function test.ok(p_cond boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_cond is not true then raise exception 'GAGAL: %', p_label; end if;
  raise notice 'ok  : %', p_label;
end $$;
grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Data awal: 4 user (signup → household otomatis), katalog global oleh sistem
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ani@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'budi@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'citra@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dewi@example.com');

select test.ok((select count(*) from public.household_member where role = 'owner') = 4,
               'signup membuat household + owner');
select set_config('test.hh_ani', household_id::text, false) from public.household_member
 where user_id = '00000000-0000-0000-0000-00000000000a';

set role service_role;
insert into public.store_group (id, name) values ('10000000-0000-0000-0000-000000000001', 'Alfa Group');
insert into public.store (id, name, channel, store_group_id) values
  ('20000000-0000-0000-0000-000000000001', 'AEON', 'offline', null),
  ('20000000-0000-0000-0000-000000000002', 'Alfamart', 'offline', '10000000-0000-0000-0000-000000000001');
insert into public.branch (id, store_id, kind, name, city) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'physical', 'AEON BSD', 'Tangerang'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'physical', 'Alfamart Serpong', 'Tangerang');
insert into public.member_program (id, store_id, name) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'AEON Member');
insert into public.brand (id, name) values ('50000000-0000-0000-0000-000000000001', 'Nestle');
insert into public.product_group (id, name, brand_id) values
  ('60000000-0000-0000-0000-000000000001', 'Milo Original', '50000000-0000-0000-0000-000000000001');
insert into public.product (id, product_group_id, brand_id, name, content_size, content_unit, pack_count, sale_mode) values
  ('70000000-0000-0000-0000-000000000200', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Milo Original', 200, 'g', 1, 'unit'),
  ('70000000-0000-0000-0000-000000000500', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Milo Original', 500, 'g', 1, 'unit'),
  ('70000000-0000-0000-0000-000000000310', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Milo 3in1', 35, 'g', 10, 'unit');
insert into public.product (id, name, content_unit, sale_mode) values
  ('70000000-0000-0000-0000-0000000000f1', 'Jeruk Medan', 'kg', 'weight');
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Sesi sebagai Ani (household A)
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';

select test.ok((select count(*) from public.household) = 1, 'Ani hanya melihat household-nya');

-- produk privat Ani
insert into public.product (id, household_id, name, content_size, content_unit)
select '70000000-0000-0000-0000-0000000000a1', id, 'Keripik Warung Bu Siti', 100, 'g' from public.household;

select test.expect_error($$insert into public.product (name, content_size, content_unit) values ('X', 1, 'g')$$,
                         'user tidak bisa membuat produk global');
with u as (update public.product set name = 'Diretas' where id = '70000000-0000-0000-0000-000000000200' returning 1)
select test.ok((select count(*) from u) = 0, 'user tidak bisa mengubah produk global (0 baris)');

-- Price record: Rp19.500 / 200 g = Rp97,5/g (contoh §5.4)
insert into public.price_record (id, household_id, product_id, store_id, branch_id, source_type,
                                 transaction_date, normal_price, effective_price, price_basis)
select '80000000-0000-0000-0000-000000000001', id, '70000000-0000-0000-0000-000000000200',
       '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
       'price_label', current_date - 5, 19500, 19500, 'normal' from public.household;
select test.ok((select unit_price from public.price_record where id = '80000000-0000-0000-0000-000000000001') = 97.5,
               'unit_price 19500/200g = 97.5');

-- Multipack 10 × 35 g, Rp21.000 → Rp60/g
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date,
                                 effective_price, price_basis)
select id, '70000000-0000-0000-0000-000000000310', '20000000-0000-0000-0000-000000000001',
       'price_label', current_date, 21000, 'normal' from public.household;
select test.ok((select unit_price from public.price_record where product_id = '70000000-0000-0000-0000-000000000310') = 60,
               'multipack 21000/(10×35g) = 60');

-- Produk timbang: Rp45.000/kg → Rp45/g
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date,
                                 actual_weight, effective_price, price_basis)
select id, '70000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-000000000001',
       'price_label', current_date, 0.535, 45000, 'normal' from public.household;
select test.ok((select unit_price from public.price_record where product_id = '70000000-0000-0000-0000-0000000000f1') = 45,
               'produk timbang 45000/kg = 45/g');

select test.expect_error($$insert into public.price_record (household_id, product_id, store_id, branch_id, source_type,
                             transaction_date, effective_price, price_basis)
                           select id, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002',
                                  '30000000-0000-0000-0000-000000000001', 'price_label', current_date, 1, 'normal'
                             from public.household$$,
                         'branch harus milik store yang sama');
select test.expect_error($$insert into public.price_record (household_id, product_id, store_id, source_type,
                             transaction_date, effective_price, price_basis, member_price)
                           select id, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001',
                                  'price_label', current_date, 1, 'member', 1 from public.household$$,
                         'harga member wajib menyebut program');

-- Struk: header + baris + diskon, lalu koreksi tanggal mengalir ke price_record
insert into public.receipt (id, household_id, store_id, branch_id, transaction_date, total_amount, status)
select '90000000-0000-0000-0000-000000000001', id, '20000000-0000-0000-0000-000000000001',
       '30000000-0000-0000-0000-000000000001', current_date - 1, 37000, 'confirmed' from public.household;
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount)
select '91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', id, 1, 'product',
       'MILO ORI 500G 2X19500', 2, 19500, 39000 from public.household;
insert into public.receipt_line (receipt_id, household_id, line_no, line_type, raw_text, line_amount, applies_to_line_id)
select '90000000-0000-0000-0000-000000000001', id, 2, 'discount', 'DISC MILO', -2000,
       '91000000-0000-0000-0000-000000000001' from public.household;
select test.expect_error($$insert into public.receipt_line (receipt_id, household_id, line_no, line_type, raw_text, line_amount)
                           select '90000000-0000-0000-0000-000000000001', id, 3, 'discount', 'X', -1 from public.household$$,
                         'baris diskon wajib menempel ke baris lain');
insert into public.price_record (household_id, product_id, store_id, branch_id, source_type, receipt_line_id,
                                 transaction_date, quantity, normal_price, promo_price, effective_price, price_basis)
select id, '70000000-0000-0000-0000-000000000500', '20000000-0000-0000-0000-000000000001',
       '30000000-0000-0000-0000-000000000001', 'receipt', '91000000-0000-0000-0000-000000000001',
       current_date - 1, 2, 19500, 18500, 18500, 'promo' from public.household;

update public.receipt set transaction_date = current_date - 2 where id = '90000000-0000-0000-0000-000000000001';
select test.ok((select transaction_date from public.price_record
                 where receipt_line_id = '91000000-0000-0000-0000-000000000001') = current_date - 2,
               'koreksi tanggal struk mengalir ke price_record');
select test.ok((select count(*) from public.audit_log where entity_type = 'receipt') = 1,
               'koreksi struk tercatat di audit_log');
select test.expect_error($$insert into public.audit_log (household_id, entity_type, entity_id, action)
                           select id, 'x', gen_random_uuid(), 'update' from public.household$$,
                         'audit_log tidak bisa ditulis user');

-- ---------------------------------------------------------------------------
-- Isolasi: Budi tidak melihat apa pun milik Ani
-- ---------------------------------------------------------------------------
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select test.ok((select count(*) from public.price_record) = 0, 'Budi tidak melihat price_record Ani');
select test.ok((select count(*) from public.receipt) = 0, 'Budi tidak melihat struk Ani');
select test.ok((select count(*) from public.product where household_id is not null) = 0,
               'Budi tidak melihat produk privat Ani');
select test.ok((select count(*) from public.product) = 4, 'Budi melihat katalog global');
select test.expect_error($$insert into public.price_record (household_id, product_id, store_id, source_type,
                             transaction_date, effective_price, price_basis)
                           values (current_setting('test.hh_ani')::uuid, '70000000-0000-0000-0000-000000000200',
                                  '20000000-0000-0000-0000-000000000001', 'price_label', current_date, 1, 'normal')$$,
                         'Budi tidak bisa menulis ke household Ani');
select test.expect_error($$insert into public.price_record (household_id, product_id, store_id, source_type,
                             transaction_date, effective_price, price_basis)
                           select id, '70000000-0000-0000-0000-0000000000a1',
                                  '20000000-0000-0000-0000-000000000001', 'price_label', current_date, 1, 'normal'
                             from public.household$$,
                         'Budi tidak bisa merujuk produk privat Ani');
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Price Summary: 90 hari vs all-time, bundle diabaikan, tren
-- ---------------------------------------------------------------------------
set role service_role;
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date,
                                 effective_price, promo_price, price_basis, is_bundle)
select hm.household_id, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', 'price_label', d, p,
       case when b = 'promo' then p end, b, bun
  from public.household_member hm,
       (values (current_date - 120, 15000::numeric, 'promo', false),      -- termurah all-time, di luar 90 hari
               (current_date - 3,   10000,          'promo', true),       -- bundle: diabaikan
               (current_date - 40,  18000,          'normal', false),
               (current_date - 45,  18000,          'normal', false),
               (current_date - 10,  19800,          'normal', false)) v(d, p, b, bun)
 where hm.user_id = '00000000-0000-0000-0000-00000000000a';

select app.process_summary_queue();
select test.ok((select best_all_effective_price = 15000 and best_all_price_basis = 'promo'
                  from public.price_summary where product_id = '70000000-0000-0000-0000-000000000200'),
               'harga terbaik all-time = 15000 (promo)');
select test.ok((select best_90d_effective_price = 18000 and best_90d_store_id = '20000000-0000-0000-0000-000000000002'
                  from public.price_summary where product_id = '70000000-0000-0000-0000-000000000200'),
               'harga terbaik 90 hari = 18000, bundle diabaikan');
select test.ok((select record_count = 5 and trend_direction = 'up'
                  from public.price_summary where product_id = '70000000-0000-0000-0000-000000000200'),
               'jumlah data 5 (tanpa bundle), tren naik');
select test.ok((select count(*) from app.summary_refresh_queue) = 0, 'antrean ringkasan kosong');
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Berbagi publik (D-25)
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
update public.price_record set visibility = 'public' where id = '80000000-0000-0000-0000-000000000001';
update public.price_record set visibility = 'public'
 where product_id = '70000000-0000-0000-0000-0000000000a1';  -- produk privat: tidak dipublikasi (0 baris pun ok)
set role anon;
select test.ok((select count(*) from public.public_price_fact) = 1, 'anon melihat 1 fakta publik');
select test.expect_error($$select 1 from public.price_record$$, 'anon tidak bisa membaca price_record');
select test.expect_error($$select 1 from app.public_price_source$$, 'tautan fakta → record tidak terbaca');
set role authenticated;
update public.price_record set visibility = 'private' where id = '80000000-0000-0000-0000-000000000001';
select test.ok((select count(*) from public.public_price_fact) = 0, 'opt-out menghapus fakta publik');
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Barcode & shrinkflation (D-18)
-- ---------------------------------------------------------------------------
set role service_role;
insert into public.barcode_assignment (product_id, code, code_type, valid_from, valid_until)
values ('70000000-0000-0000-0000-000000000200', '8992696404441', 'gtin', '2024-01-01', '2026-01-01');
insert into public.barcode_assignment (product_id, code, code_type, valid_from)
values ('70000000-0000-0000-0000-000000000500', '8992696404441', 'gtin', '2026-01-01');
select test.ok(true, 'barcode sama boleh berpindah produk di periode berbeda');
select test.expect_error($$insert into public.barcode_assignment (product_id, code, code_type, valid_from)
                           values ('70000000-0000-0000-0000-000000000310', '8992696404441', 'gtin', '2025-06-01')$$,
                         'barcode tidak boleh tumpang tindih periode');
select test.expect_error($$insert into public.barcode_assignment (product_id, code, code_type)
                           values ('70000000-0000-0000-0000-0000000000f1', '1234', 'plu')$$,
                         'PLU wajib menyebut store');
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Merge produk (D-21, D-30)
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date,
                                 effective_price, price_basis)
select id, '70000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000001',
       'price_label', current_date, 9000, 'normal' from public.household;
select test.expect_error($$select public.merge_product('70000000-0000-0000-0000-000000000200',
                                                       '70000000-0000-0000-0000-000000000500')$$,
                         'user tidak bisa merge produk global');
select public.merge_product('70000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-000000000200');
select test.ok((select count(*) from public.price_record where product_id = '70000000-0000-0000-0000-0000000000a1') = 0,
               'merge memindahkan histori ke produk pengganti');
select test.ok((select status = 'merged' from public.product where id = '70000000-0000-0000-0000-0000000000a1'),
               'produk lama berstatus merged');
select test.ok((select count(*) from public.audit_log where action = 'merge') = 1, 'merge tercatat di audit_log');
reset role;
reset request.jwt.claims;
set role service_role;
insert into public.product (id, name, content_size, content_unit) values
  ('70000000-0000-0000-0000-0000000000d1', 'Milo Duplikat', 200, 'g'),
  ('70000000-0000-0000-0000-0000000000d2', 'Milo Duplikat 2', 200, 'g');
select public.merge_product('70000000-0000-0000-0000-0000000000d1', '70000000-0000-0000-0000-000000000200');
select test.ok((select merged_into_id = '70000000-0000-0000-0000-000000000200' from public.product
                 where id = '70000000-0000-0000-0000-0000000000d1'), 'sistem bisa merge produk global');
select test.expect_error($$select public.merge_product('70000000-0000-0000-0000-0000000000d2',
                                                       '70000000-0000-0000-0000-0000000000d1')$$,
                         'target merge tidak boleh produk yang sudah merged');
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Koreksi ukuran produk → job hitung ulang unit_price (B-2)
-- ---------------------------------------------------------------------------
set role service_role;
update public.product set content_size = 250 where id = '70000000-0000-0000-0000-000000000200';
select test.ok((select count(*) from app.job where kind = 'recompute_unit_price') = 1, 'koreksi ukuran membuat job');
select test.ok(app.recompute_unit_prices('70000000-0000-0000-0000-000000000200') > 0, 'job menghitung ulang record');
select test.ok((select unit_price from public.price_record where id = '80000000-0000-0000-0000-000000000001') = 78,
               'unit_price baru 19500/250g = 78');
select test.ok(app.recompute_unit_prices('70000000-0000-0000-0000-000000000200') = 0, 'job idempoten');
update public.product set content_size = 200 where id = '70000000-0000-0000-0000-000000000200';
select app.recompute_unit_prices('70000000-0000-0000-0000-000000000200');
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Promosi alias (D-35)
-- ---------------------------------------------------------------------------
set role authenticated;
do $$
declare u text;
begin
  foreach u in array array['a', 'b', 'c'] loop
    perform set_config('request.jwt.claims', format('{"sub":"00000000-0000-0000-0000-00000000000%s"}', u), false);
    insert into public.product_alias (household_id, store_id, product_id, alias_text)
    select id, '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000500', 'MILO ORI  500G'
      from public.household;
  end loop;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d"}';
insert into public.product_alias (household_id, store_id, product_id, alias_text)
select id, '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000200', 'milo ori 200g'
  from public.household;
reset role;
reset request.jwt.claims;

set role service_role;
select test.ok(app.promote_aliases() = 1, '3 household → 1 alias dipromosikan');
select test.ok(app.promote_aliases() = 0, 'promosi idempoten');
select test.ok((select normalized_text = 'milo ori 500g' from public.product_alias where household_id is null),
               'teks alias ternormalisasi');
reset role;
reset request.jwt.claims;

\echo 'SEMUA SMOKE TEST LULUS'
