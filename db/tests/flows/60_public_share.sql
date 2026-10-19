-- 60 · Berbagi publik (§4.6, D-25, D-51, D-67, F-02): insert mengikuti flag, opt-out menarik
--      semua, bagikan data lama per batch, race opt-out vs batch (dua sesi via dblink).
\ir ../lib/harness.sql
\ir ../lib/seed.sql
create extension if not exists dblink with schema test;

-- Tiga record lama Ani (privat), dua di katalog global, satu produk privat.
insert into public.product (id, household_id, name, content_size, content_unit)
values ('7a000000-0000-0000-0000-000000000001', test.hh('a'), 'Keripik Ani', 100, 'g');
insert into public.price_record (id, household_id, product_id, store_id, branch_id, source_type, transaction_date, effective_price, price_basis) values
  ('8a000000-0000-0000-0000-000000000001', test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'price_label', current_date - 3, 19500, 'normal'),
  ('8a000000-0000-0000-0000-000000000002', test.hh('a'), '70000000-0000-0000-0000-000000000500', '20000000-0000-0000-0000-000000000002', null, 'price_label', current_date - 2, 45000, 'normal'),
  ('8a000000-0000-0000-0000-000000000003', test.hh('a'), '7a000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'price_label', current_date - 1, 9000, 'normal');

select test.login(test.uid('b'));
select test.expect_code($$select public.share_existing_prices()$$, 'INVALID_STATE', 'W15: opt-in mati → INVALID_STATE');
select test.login(test.uid('a'));
select test.ok((select r = '{"enabled": true, "withdrawn_count": 0}' from public.set_share_prices_public(true) r),
               'W14: opt-in dinyalakan');
select test.ok((select count(*) = 0 from public.public_price_fact), 'D-51: data lama tidak disentuh saat opt-in');

-- Record baru mengikuti flag (D-67)
insert into public.price_record (id, household_id, product_id, store_id, source_type, transaction_date, effective_price, price_basis)
values ('8a000000-0000-0000-0000-000000000004', test.hh('a'), '70000000-0000-0000-0000-000000000200',
        '20000000-0000-0000-0000-000000000002', 'price_label', current_date, 19000, 'normal');
select test.ok((select visibility = 'public' from public.price_record where id = '8a000000-0000-0000-0000-000000000004')
               and (select count(*) = 1 from public.public_price_fact),
               'D-67: record baru publik dan terproyeksi');

-- F-02: hapus record publik → fakta ikut hilang
delete from public.price_record where id = '8a000000-0000-0000-0000-000000000004';
select test.ok((select count(*) = 0 from public.public_price_fact), 'F-02: hapus record publik → fakta hilang (BEFORE DELETE)');

-- Bagikan data lama
create temp table j1 as select public.share_existing_prices() as r;
select test.ok((select (r ->> 'eligible_count')::int = 3 and r ->> 'job_id' is not null from j1),
               'W15: job dibuat, 3 record layak');
select test.ok((select public.share_existing_prices() ->> 'job_id' = (select r ->> 'job_id' from j1)),
               'W15: dedup job yang masih pending');
select test.logout();
select test.ok(app.share_existing_batch(test.hh('a'), 2) = 2, 'batch 1: 2 record dibagikan');
select test.ok(app.run_sql_jobs(10) >= 1, 'pg_cron run_sql_jobs memproses job');
select test.ok((select status = 'done' from app.job where kind = 'share_existing_prices'), 'job selesai setelah batch kosong');
select test.ok((select count(*) = 3 from public.price_record where household_id = test.hh('a') and visibility = 'public'),
               '3 record lama menjadi publik');
select test.ok((select count(*) = 2 from public.public_price_fact),
               'D-25: hanya produk/toko/cabang global yang menjadi fakta (2 dari 3)');
select test.ok(not exists (select 1 from public.public_price_fact where product_id = '7a000000-0000-0000-0000-000000000001'),
               'produk privat tidak diproyeksikan');

-- Opt-out menarik semua (sinkron)
select test.login(test.uid('a'));
select test.ok((select (r ->> 'withdrawn_count')::int = 3 from public.set_share_prices_public(false) r),
               'W14: opt-out → 3 record ditarik');
select test.ok((select count(*) = 0 from public.public_price_fact), 'D-51: opt-out menghapus semua fakta');
select test.ok((select count(*) = 0 from public.price_record where visibility = 'public'), 'semua record kembali privat');
select test.logout();
select test.ok(app.share_existing_batch(test.hh('a'), 1000) = -1, 'batch setelah opt-out → dibatalkan (-1)');

-- ---------------------------------------------------------------------------
-- Race: opt-out (sesi 2, belum commit) vs batch (sesi 3). Batch menunggu FOR SHARE,
-- lalu membaca false dan tidak membuat satu pun record publik.
-- ---------------------------------------------------------------------------
update public.household set share_prices_public = true where id = test.hh('a');
select test.dblink_connect('optout', 'dbname=' || current_database() || ' user=postgres');
select test.dblink_connect('batch',  'dbname=' || current_database() || ' user=postgres');
select test.dblink_exec('optout', 'begin');
select * from test.dblink('optout', format($$select set_config('request.jwt.claims', '{"sub": "%s"}', true)$$, test.uid('a'))) as t(r text);
select test.dblink_exec('optout', 'set local role authenticated');
select * from test.dblink('optout', 'select public.set_share_prices_public(false)::text') as t(r text);
select test.dblink_send_query('batch', format('select app.share_existing_batch(%L, 1000)', test.hh('a')));
select pg_sleep(0.5);
select test.ok(test.dblink_is_busy('batch') = 1, 'race: batch menunggu transaksi opt-out (FOR SHARE)');
select test.dblink_exec('optout', 'commit');
select test.ok((select r = -1 from test.dblink_get_result('batch') as t(r integer)), 'race: batch membaca opt-out lalu berhenti');
select test.ok((select count(*) = 0 from public.price_record where household_id = test.hh('a') and visibility = 'public')
               and (select count(*) = 0 from public.public_price_fact),
               'race: tidak ada record yang menjadi publik setelah opt-out');
select test.dblink_disconnect('optout');
select test.dblink_disconnect('batch');

-- Hak: W14/W15 hanya owner
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'eka@example.com');
delete from public.household_member where user_id = '00000000-0000-0000-0000-00000000000e';
insert into public.household_member (household_id, user_id, role) values (test.hh('a'), '00000000-0000-0000-0000-00000000000e', 'member');
select test.login('00000000-0000-0000-0000-00000000000e');
select test.expect_code($$select public.set_share_prices_public(true)$$, 'FORBIDDEN', 'W14: hanya owner');
select test.logout();
