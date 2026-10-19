-- Inventaris hak anon/authenticated atas tabel, kolom, sequence, dan fungsi di schema
-- public dan app (F-09). Dipakai 99_privilege_inventory.sql dan db/scripts/privileges.sh.
create or replace view test.privilege_inventory as
with roles(r) as (values ('anon'), ('authenticated')),
rels as (
  select c.oid, n.nspname || '.' || c.relname as obj, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'app') and c.relkind in ('r', 'v', 'm', 'S', 'p')),
tbl as (
  select r, 'table'::text as kind, obj, string_agg(p, ',' order by p) as privs
    from roles, rels, unnest(case when relkind = 'S' then array['USAGE','SELECT','UPDATE']
                                  else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] end) p
   where case when relkind = 'S' then has_sequence_privilege(r, oid, p) else has_table_privilege(r, oid, p) end
   group by r, obj),
col as (
  select r, 'column'::text as kind, obj || '.' || a.attname as obj, string_agg(p, ',' order by p) as privs
    from roles, rels join pg_attribute a on a.attrelid = rels.oid and a.attnum > 0 and not a.attisdropped,
         unnest(array['SELECT','INSERT','UPDATE']) p
   where relkind in ('r', 'v') and has_column_privilege(r, rels.oid, a.attnum, p)
     and not has_table_privilege(r, rels.oid, p)
   group by r, obj, a.attname),
fn as (
  select r, 'function'::text as kind,
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as obj,
         'EXECUTE'::text as privs
    from roles, pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and has_function_privilege(r, p.oid, 'EXECUTE'))
select r as role, kind, obj, privs from tbl
union all select r, kind, obj, privs from col
union all select r, kind, obj, privs from fn;
