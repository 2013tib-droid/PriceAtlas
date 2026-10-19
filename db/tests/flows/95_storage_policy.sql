-- 95 · Policy Storage bucket captures (§7.3, D-69, F-14) terhadap stub storage.objects.
\ir ../lib/harness.sql
\ir ../lib/seed.sql

select test.ok((select not public and file_size_limit = 10485760
                       and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
                  from storage.buckets where id = 'captures'),
               'D-69: bucket privat, 10 MB, jpeg/png/webp/heic');

select test.login(test.uid('a'));
insert into storage.objects (bucket_id, name)
values ('captures', test.hh('a') || '/ca000000-0000-0000-0000-000000000001/1.jpg');
select test.ok(true, 'A mengunggah ke foldernya sendiri');
select test.expect_code(format($$insert into storage.objects (bucket_id, name) values ('captures', %L)$$,
                               test.hh('b') || '/ca000000-0000-0000-0000-000000000002/1.jpg'),
                        '42501', 'A tidak bisa menulis ke folder household B');
select test.expect_code(format($$insert into storage.objects (bucket_id, name) values ('captures', %L)$$,
                               test.hh('a') || '/1.jpg'),
                        '42501', 'path wajib {household}/{capture}/{file}');
select test.expect_code($$insert into storage.objects (bucket_id, name) values ('captures', 'bukan-uuid/x/1.jpg')$$,
                        '42501', 'F-14: folder bukan UUID ditolak tanpa error cast');
select test.expect_code(format($$insert into storage.objects (bucket_id, name) values ('lain', %L)$$,
                               test.hh('a') || '/x/1.jpg'),
                        '42501', 'bucket lain tidak tercakup policy');
select test.ok((select count(*) = 1 from storage.objects), 'A membaca objeknya sendiri');
with u as (update storage.objects set name = name || 'x' returning 1)
select test.ok((select count(*) = 0 from u), 'F-14: user tidak bisa menimpa objek (0 baris)');
with d as (delete from storage.objects returning 1)
select test.ok((select count(*) = 0 from d), 'F-14: user tidak bisa menghapus objek (0 baris)');
select test.ok((select count(*) = 1 from storage.objects where bucket_id = 'captures'), 'objek tetap ada');

select test.login(test.uid('b'));
select test.ok((select count(*) = 0 from storage.objects), 'B tidak melihat objek A');
select test.ok((select count(*) = 0 from storage.objects where name like 'bukan-uuid%'), 'B: nama aneh tidak error');
select test.expect_code(format($$insert into storage.objects (bucket_id, name) values ('captures', %L)$$,
                               test.hh('a') || '/ca000000-0000-0000-0000-000000000009/1.jpg'),
                        '42501', 'B tidak bisa menulis ke folder A');

select test.login('00000000-0000-0000-0000-0000000000ff');
select test.ok((select count(*) = 0 from storage.objects), 'user tanpa household tidak melihat apa pun');

set role anon;
select test.ok((select count(*) = 0 from storage.objects), 'anon tidak melihat objek');
select test.logout();

-- Penghapusan hanya oleh service role (Storage API).
select test.as_service();
delete from storage.objects where bucket_id = 'captures';
select test.ok((select count(*) = 0 from storage.objects), 'service role bisa menghapus objek');
select test.logout();
