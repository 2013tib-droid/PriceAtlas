-- L4 · Lingkungan Supabase asli (docs/07 §1.2, D-78). Dijalankan run.sh terhadap DB `supabase start`.
-- Harness sama dengan db/tests/flows (ok/expect_error).
\ir ../../../db/tests/lib/harness.sql

-- F-22: worker terhubung sebagai `postgres` lalu memakai service_role (parameter startup
-- -c role=service_role, apps/worker/src/db.ts). Itu hanya bisa jika postgres anggota service_role.
select test.ok(pg_has_role('postgres', 'service_role', 'MEMBER'), 'F-22: postgres anggota service_role');
set role service_role;
select test.ok(current_user = 'service_role', 'F-22: SET ROLE service_role berhasil');
select test.ok(has_function_privilege('service_role', 'public.begin_account_deletion(uuid)', 'EXECUTE'),
               'service_role menjalankan begin_account_deletion');
reset role;

-- 0230: ALTER DATABASE … SET timezone oleh pemilik database (docs/07 §1.2).
select test.ok(current_setting('TimeZone') = 'Asia/Jakarta', 'D-68: zona waktu database Asia/Jakarta (sesi baru)');

-- D-69 / 0150: bucket dan policy Storage asli.
select test.ok(exists (select 1 from storage.buckets
                        where id = 'captures' and not public and file_size_limit = 10485760
                          and allowed_mime_types @> array['image/jpeg','image/png','image/webp','image/heic']
                          and cardinality(allowed_mime_types) = 4),
               'D-69: bucket captures privat, 10 MB, jpeg/png/webp/heic');
select test.ok((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname in ('captures_read', 'captures_insert')) = 2,
               'D-69: policy captures_read + captures_insert ada di storage.objects');
select test.ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                             and policyname like 'captures%' and cmd in ('UPDATE', 'DELETE', 'ALL')),
               'D-69: tidak ada policy UPDATE/DELETE captures untuk user');

-- 0900 + 20261031000200 (F-184): pg_cron tersedia di Supabase, 7 jadwal dibuat.
select test.ok((select count(*) from cron.job
                 where jobname in ('summary-queue', 'summary-time', 'alias-promote', 'sql-jobs', 'reap-stale-runs', 'retention',
                                   'cron-cleanup')) = 7,
               '0900 + cron-cleanup: 7 jadwal pg_cron terdaftar');
select test.ok((select schedule from cron.job where jobname = 'cron-cleanup') = '45 17 * * *',
               'F-184: cron-cleanup harian 17:45 UTC');
-- Perintah pembersih bisa dijalankan role pemilik jadwal (postgres) tanpa error hak akses.
do $$
begin
  execute (select command from cron.job where jobname = 'cron-cleanup');
end
$$;
select test.ok(true, 'F-184: perintah cron-cleanup jalan sebagai pemilik jadwal');

-- Baseline: trigger signup → profile + household.
select test.ok(exists (select 1 from pg_trigger where tgname = 'on_auth_user_created'
                         and tgrelid = 'auth.users'::regclass and not tgisinternal),
               'trigger on_auth_user_created di auth.users');

-- Extension dari baseline ada di schema extensions (bukan public, F-09).
select test.ok((select string_agg(e.extname || '@' || n.nspname, ',' order by e.extname)
                  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                 where e.extname in ('pg_trgm', 'btree_gist')) = 'btree_gist@extensions,pg_trgm@extensions',
               'pg_trgm dan btree_gist di schema extensions');
