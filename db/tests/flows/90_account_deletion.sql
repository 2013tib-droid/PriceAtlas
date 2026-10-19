-- 90 · Hapus akun (§7.6, BR-8, D-65, Q-06): fakta publik tetap ada tanpa tautan,
--      seluruh data household terhapus, household lain utuh, sapuan household tanpa anggota.
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- Data Ani di banyak tabel + fakta publik; data Budi sebagai pembanding.
update public.household set share_prices_public = true where id = test.hh('a');
insert into public.product (id, household_id, name, content_size, content_unit)
values ('7a000000-0000-0000-0000-000000000001', test.hh('a'), 'Keripik Ani', 100, 'g');
insert into public.barcode_assignment (product_id, code, code_type) values ('7a000000-0000-0000-0000-000000000001', '12345670', 'gtin');
insert into public.store (id, household_id, name, channel) values ('2a000000-0000-0000-0000-000000000001', test.hh('a'), 'Warung Ani', 'offline');
insert into public.product_alias (household_id, store_id, product_id, alias_text)
values (test.hh('a'), '2a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 'KRP');
insert into public.capture (id, household_id, kind, uploaded_by) values ('ca000000-0000-0000-0000-000000000001', test.hh('a'), 'receipt', test.uid('a'));
insert into public.capture_image (capture_id, household_id, position, storage_path, sha256)
values ('ca000000-0000-0000-0000-000000000001', test.hh('a'), 1, test.hh('a') || '/ca000000-0000-0000-0000-000000000001/1.jpg', repeat('c', 64));
insert into public.receipt (id, household_id, capture_id, store_id, transaction_date, total_amount, status, pii)
values ('90000000-0000-0000-0000-000000000001', test.hh('a'), 'ca000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', current_date, 19500, 'confirmed', '{"phone": "0812"}');
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount)
values ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', test.hh('a'), 1, 'product', 'MILO', 1, 19500, 19500);
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000200', 'confirmed');
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date, effective_price, price_basis, created_by) values
  (test.hh('a'), '70000000-0000-0000-0000-000000000500', '20000000-0000-0000-0000-000000000002', 'price_label', current_date, 45000, 'normal', test.uid('a')),
  (test.hh('a'), '7a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', 'price_label', current_date, 9000, 'normal', test.uid('a')),
  (test.hh('b'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', 'price_label', current_date, 19900, 'normal', test.uid('b'));
update public.price_record set visibility = 'public' where household_id = test.hh('b');
select app.process_summary_queue();
select test.login(test.uid('a'));
update public.product set variant = 'pedas' where id = '7a000000-0000-0000-0000-000000000001';      -- audit
select test.logout();

select test.ok((select count(*) = 3 from public.public_price_fact), 'awal: 2 fakta Ani + 1 fakta Budi');
create temp table a_counts as
select (select count(*) from public.price_record where household_id = test.hh('b')) as b_records,
       (select count(*) from public.price_summary where household_id = test.hh('b')) as b_summary;

-- Langkah 2: begin_account_deletion hanya untuk service role
select test.login(test.uid('a'));
select test.expect_code(format('select public.begin_account_deletion(%L)', test.uid('a')), '42501',
                        '§7.6: user tidak bisa menjalankan begin_account_deletion');
select test.as_service();
select test.ok((select r -> 'archived_households' = jsonb_build_array(test.hh('a'))
                  from public.begin_account_deletion(test.uid('a')) r),
               '§7.6: household satu-anggota diarsipkan');
select public.begin_account_deletion(test.uid('a'));
select test.logout();
select test.ok((select count(*) = 1 from app.job where kind = 'delete_household' and payload ->> 'household_id' = test.hh('a')::text),
               '§7.6: langkah 2 idempoten (satu job)');
select test.ok((select archived_at is not null from public.household where id = test.hh('a')), 'household archived_at terisi');

-- Job menunggu sampai user benar-benar dihapus (langkah 3)
select test.ok(app.prepare_household_deletion(test.hh('a')) = 'has_members', 'job menunggu: household masih punya anggota');
select test.ok(not app.finish_household_deletion(test.hh('a')), 'finish menolak selama masih ada anggota');

-- Langkah 3: auth.admin.deleteUser → cascade profile + membership
delete from auth.users where id = test.uid('a');
select test.ok((select count(*) = 0 from public.profile where user_id = '00000000-0000-0000-0000-00000000000a'), 'profile ikut terhapus');

create temp table hh_a as select household_id as id from (select distinct household_id from public.price_record
  where product_id = '7a000000-0000-0000-0000-000000000001') x;
select test.ok(app.prepare_household_deletion((select id from hh_a)) = 'ready', 'tanpa anggota → siap dihapus');
select test.ok((select count(*) = 3 from public.public_price_fact)
               and (select count(*) = 1 from app.public_price_source), 'D-65: tautan fakta Ani dilepas, fakta tetap');
select test.ok(app.finish_household_deletion((select id from hh_a)), 'household dihapus');

-- Semua tabel ber-household_id tidak lagi punya baris Ani (otomatis dari katalog)
do $$
declare t text; v_n bigint; v_h uuid := (select id from hh_a);
begin
  for t in select table_name from information_schema.columns
            where table_schema = 'public' and column_name = 'household_id' order by 1 loop
    execute format('select count(*) from public.%I where household_id = $1', t) into v_n using v_h;
    perform test.ok(v_n = 0, format('BR-8: public.%s tanpa baris household terhapus', t));
  end loop;
  perform test.ok(not exists (select 1 from public.household where id = v_h), 'BR-8: household terhapus');
  perform test.ok(not exists (select 1 from app.summary_refresh_queue where household_id = v_h), 'antrean ringkasan bersih');
end $$;
select test.ok((select count(*) = 3 from public.public_price_fact), 'BR-8: fakta publik anonim tetap ada (3)');
select test.ok((select count(*) = 1 from app.public_price_source), 'hanya tautan fakta Budi yang tersisa');
select test.ok((select b_records = (select count(*) from public.price_record where household_id = test.hh('b'))
                       and b_summary = (select count(*) from public.price_summary where household_id = test.hh('b'))
                  from a_counts) and test.hh('b') is not null,
               'data household lain utuh');
select test.ok(app.prepare_household_deletion((select id from hh_a)) = 'gone', 'job idempoten: household sudah tidak ada');

-- Jaring pengaman: household tanpa anggota > 1 jam diantrekan oleh enqueue_retention
delete from auth.users where id = test.uid('c');
update public.household h set created_at = now() - interval '2 hours'
 where not exists (select 1 from public.household_member m where m.household_id = h.id);
select test.ok((select (r ->> 'delete_household')::int = 1 from app.enqueue_retention() r),
               '§7.6: sapuan household tanpa anggota (user dihapus dari dashboard)');
select test.ok((select (r ->> 'delete_household')::int = 0 from app.enqueue_retention() r), 'sapuan idempoten');
