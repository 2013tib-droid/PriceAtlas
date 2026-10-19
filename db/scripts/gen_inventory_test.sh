#!/usr/bin/env bash
# Tulis ulang db/tests/flows/99_privilege_inventory.sql dari keadaan migration saat ini.
# HANYA dijalankan setelah perubahan hak ditinjau (diff file ini adalah bahan review).
set -euo pipefail
cd "$(dirname "$0")/../.."
list=$(db/scripts/privileges.sh | sed '$ s/,$//')
{
cat <<'HDR'
-- 99 · Inventaris hak akses anon/authenticated = whitelist (F-09, docs/05 §7.2, §8.2).
-- Hak baru yang tidak ada di daftar, atau hak di daftar yang hilang, membuat test gagal.
-- Daftar dibangkitkan oleh db/scripts/gen_inventory_test.sh dan WAJIB ditinjau lewat diff.
\ir ../lib/harness.sql
\ir ../lib/privilege_inventory.sql

create table test.privilege_whitelist (role text, kind text, obj text, privs text);
insert into test.privilege_whitelist values
HDR
echo "$list;"
cat <<'FTR'

do $$
declare
  v_extra   text;
  v_missing text;
begin
  select string_agg(format('%s %s %s [%s]', role, kind, obj, privs), E'\n') into v_extra
    from (select * from test.privilege_inventory except select * from test.privilege_whitelist) x;
  select string_agg(format('%s %s %s [%s]', role, kind, obj, privs), E'\n') into v_missing
    from (select * from test.privilege_whitelist except select * from test.privilege_inventory) x;
  perform test.ok(v_extra is null, 'tidak ada hak di luar whitelist' || coalesce(E':\n' || v_extra, ''));
  perform test.ok(v_missing is null, 'semua hak di whitelist ada' || coalesce(E':\n' || v_missing, ''));
  perform test.ok(not exists (select 1 from test.privilege_inventory
                               where role = 'anon' and kind <> 'function'
                                 and obj not in ('public.public_price_fact', 'public.unit')),
                  'anon hanya membaca public_price_fact dan unit');
  perform test.ok(not exists (select 1 from test.privilege_inventory
                               where obj like 'app.%' and kind <> 'function'),
                  'tabel schema app tidak terbuka untuk anon/authenticated');
  perform test.ok(not exists (select 1 from test.privilege_inventory
                               where role = 'anon' and kind = 'function' and obj like 'public.%'),
                  'anon tidak bisa menjalankan RPC apa pun');
  perform test.ok(not exists (select 1 from test.privilege_inventory
                               where obj in ('public.receipt.pii', 'public.processing_run.raw_ocr_text',
                                             'public.processing_run.raw_ai_output')
                                  or (obj in ('public.receipt', 'public.processing_run') and privs like '%SELECT%')),
                  'F-03/F-04: pii dan raw_* tidak terbaca');
end $$;
FTR
} > db/tests/flows/99_privilege_inventory.sql
