-- 98 · Matriks RLS lintas household, dibangkitkan otomatis dari katalog (docs/05 §8.2).
--   * Setiap tabel di schema public: sebagai user B terhadap baris milik A →
--     select 0 baris, update/delete 0 baris (atau ditolak hak), insert ditolak (42501).
--   * Setiap RPC baca (fungsi STABLE di public): hasil sebagai B tidak memuat id milik A.
-- Tabel atau RPC baru otomatis tercakup. Tabel tanpa household_id harus diklasifikasi
-- di daftar khusus di bawah, dan parameter RPC baru harus dipetakan, atau test gagal.
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- ---------------------------------------------------------------------------
-- Data milik A di setiap tabel household/hybrid (ditulis sebagai superuser)
-- ---------------------------------------------------------------------------
insert into public.brand (id, household_id, name) values ('5a000000-0000-0000-0000-000000000001', test.hh('a'), 'Merek Ani');
insert into public.category (id, household_id, name) values ('ca000000-0000-0000-0000-000000000001', test.hh('a'), 'Kategori Ani');
insert into public.product_group (id, household_id, brand_id, category_id, name)
values ('6a000000-0000-0000-0000-000000000001', test.hh('a'), '5a000000-0000-0000-0000-000000000001',
        'ca000000-0000-0000-0000-000000000001', 'Keripik Ani');
insert into public.product (id, household_id, product_group_id, brand_id, name, content_size, content_unit)
values ('7a000000-0000-0000-0000-000000000001', test.hh('a'), '6a000000-0000-0000-0000-000000000001',
        '5a000000-0000-0000-0000-000000000001', 'Keripik Bu Siti Rahasia', 100, 'g');
insert into public.barcode_assignment (id, product_id, code, code_type)
values ('ba000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', '12345670', 'gtin');
insert into public.store (id, household_id, name, channel) values ('2a000000-0000-0000-0000-000000000001', test.hh('a'), 'Warung Ani', 'offline');
insert into public.branch (id, household_id, store_id, kind, name)
values ('3a000000-0000-0000-0000-000000000001', test.hh('a'), '2a000000-0000-0000-0000-000000000001', 'physical', 'Warung Ani Pusat');
insert into public.product_alias (id, household_id, store_id, product_id, alias_text)
values ('aa000000-0000-0000-0000-000000000001', test.hh('a'), '2a000000-0000-0000-0000-000000000001',
        '7a000000-0000-0000-0000-000000000001', 'KRP SITI');
insert into public.household_program_membership (household_id, member_program_id)
values (test.hh('a'), '40000000-0000-0000-0000-000000000001');
insert into public.shopping_session (id, household_id, branch_id)
values ('5e000000-0000-0000-0000-000000000001', test.hh('a'), '3a000000-0000-0000-0000-000000000001');
insert into public.capture (id, household_id, kind, store_id, branch_id, shopping_session_id)
values ('ca100000-0000-0000-0000-000000000001', test.hh('a'), 'price_label', '2a000000-0000-0000-0000-000000000001',
        '3a000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001'),
       ('ca100000-0000-0000-0000-000000000002', test.hh('a'), 'receipt', null, null, null);
insert into public.capture_image (id, capture_id, household_id, position, storage_path, sha256)
values ('c1000000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', test.hh('a'), 1,
        test.hh('a') || '/ca100000-0000-0000-0000-000000000001/1.jpg', repeat('a', 64));
insert into public.processing_run (id, capture_id, household_id, status)
values ('a0000000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', test.hh('a'), 'running');
insert into public.receipt (id, household_id, capture_id, store_id, branch_id, transaction_date, total_amount, status)
values ('9a000000-0000-0000-0000-000000000001', test.hh('a'), 'ca100000-0000-0000-0000-000000000002',
        '2a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001', current_date - 2, 30000, 'confirmed');
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount, suggested_product_id)
values ('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', test.hh('a'), 1, 'product',
        'KRP SITI', 2, 15000, 30000, '7a000000-0000-0000-0000-000000000001');
insert into public.receipt_adjustment (id, receipt_id, household_id, kind, amount)
values ('9c000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', test.hh('a'), 'voucher', -5000);
select app.upsert_receipt_record('9b000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 'confirmed');
insert into public.price_record (id, household_id, product_id, store_id, branch_id, source_type, capture_id,
                                 transaction_date, normal_price, effective_price, price_basis)
values ('8a000000-0000-0000-0000-000000000001', test.hh('a'), '7a000000-0000-0000-0000-000000000001',
        '2a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001', 'price_label',
        'ca100000-0000-0000-0000-000000000001', current_date, 16000, 16000, 'normal');
insert into public.capture_item (id, capture_id, household_id, position, raw_text, transaction_date, store_id,
                                 suggested_product_id, normal_price)
values ('c2000000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', test.hh('a'), 1, 'KRP SITI',
        current_date, '2a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 15500);
select app.process_summary_queue();
select test.login(test.uid('a'));
update public.product set variant = 'pedas' where id = '7a000000-0000-0000-0000-000000000001';   -- audit_log
select test.logout();

-- Semua id milik A (untuk mendeteksi kebocoran lewat RPC)
create table test.a_ids (id text primary key);
do $$
declare t text;
begin
  insert into test.a_ids values (test.hh('a')::text), (test.uid('a')::text);
  for t in select c.table_name from information_schema.columns c
            where c.table_schema = 'public' and c.column_name = 'household_id'
              and exists (select 1 from information_schema.columns i
                           where i.table_schema = 'public' and i.table_name = c.table_name
                             and i.column_name = 'id' and i.data_type = 'uuid')
  loop
    execute format('insert into test.a_ids select id::text from public.%I where household_id = $1 on conflict do nothing', t)
      using test.hh('a');
  end loop;
end $$;
grant select on test.a_ids to authenticated;

-- ---------------------------------------------------------------------------
-- Matriks tabel
-- ---------------------------------------------------------------------------
create function test.try_rows(p_sql text) returns text
language plpgsql as $$
declare v_n bigint;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n::text;
exception when insufficient_privilege then
  return 'denied';
end $$;

create function test.try_insert(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'inserted';
exception when others then
  return sqlstate;
end $$;
grant execute on all functions in schema test to authenticated;

do $$
declare
  -- Tabel tanpa household_id, diklasifikasi eksplisit (desain fisik §6.1).
  v_special constant text[] := array['household', 'profile', 'unit', 'store_group', 'member_program', 'public_price_fact'];
  v_hh_a  uuid := test.hh('a');
  v_t     text;
  v_cols  text;
  v_row   jsonb;
  v_n     bigint;
  v_r     text;
  v_tables int := 0;
begin
  for v_t in select tablename from pg_tables where schemaname = 'public' order by 1 loop
    v_tables := v_tables + 1;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_t and column_name = 'household_id') then
      if not (v_t = any (v_special)) then
        raise exception 'GAGAL: tabel public.% belum diklasifikasi di 98_rls_matrix', v_t;
      end if;
      continue;
    end if;

    -- baris A sebagai contoh insert (superuser)
    execute format('select to_jsonb(t) from public.%I t where household_id = $1 limit 1', v_t) into v_row using v_hh_a;
    if v_row is null then
      raise exception 'GAGAL: tidak ada data A di public.% untuk diuji', v_t;
    end if;
    if v_row ? 'id' and jsonb_typeof(v_row -> 'id') = 'string' and (v_row ->> 'id') ~ '^[0-9a-f-]{36}$' then
      v_row := jsonb_set(v_row, '{id}', to_jsonb(gen_random_uuid()));
    end if;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
      from pg_attribute a
     where a.attrelid = ('public.' || quote_ident(v_t))::regclass and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity <> 'a';

    perform test.login(test.uid('b'));
    execute format('select count(*) from public.%I where household_id = $1', v_t) into v_n using v_hh_a;
    perform test.ok(v_n = 0, format('RLS %s: B membaca 0 baris A', v_t));

    v_r := test.try_rows(format('update public.%I set household_id = household_id where household_id = %L', v_t, v_hh_a));
    perform test.ok(v_r in ('0', 'denied'), format('RLS %s: B update baris A → %s', v_t, v_r));

    v_r := test.try_rows(format('delete from public.%I where household_id = %L', v_t, v_hh_a));
    perform test.ok(v_r in ('0', 'denied'), format('RLS %s: B delete baris A → %s', v_t, v_r));

    v_r := test.try_insert(format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, %L)',
                                  v_t, v_cols, v_cols, v_t, v_row));
    perform test.ok(v_r = '42501', format('RLS %s: B insert dengan household A ditolak (%s)', v_t, v_r));
    perform test.logout();
  end loop;

  -- Tabel khusus
  perform test.login(test.uid('b'));
  perform test.ok((select count(*) from public.household where id = v_hh_a) = 0, 'RLS household: B tidak melihat household A');
  v_r := test.try_rows(format('update public.household set name = %L where id = %L', 'x', v_hh_a));
  perform test.ok(v_r in ('0', 'denied'), 'RLS household: B update household A → ' || v_r);
  v_r := test.try_rows(format('delete from public.household where id = %L', v_hh_a));
  perform test.ok(v_r in ('0', 'denied'), 'RLS household: B delete household A → ' || v_r);
  perform test.ok((select count(*) from public.profile where user_id = test.uid('a')) = 0, 'RLS profile: B tidak melihat profil A');
  v_r := test.try_rows(format('update public.profile set display_name = %L where user_id = %L', 'x', test.uid('a')));
  perform test.ok(v_r in ('0', 'denied'), 'RLS profile: B update profil A → ' || v_r);
  foreach v_t in array array['unit', 'store_group', 'member_program', 'public_price_fact'] loop
    v_r := test.try_rows(format('delete from public.%I', v_t));
    perform test.ok(v_r = 'denied', format('SYSTEM %s: user tidak bisa menghapus', v_t));
  end loop;
  perform test.logout();
  perform test.ok(v_tables >= 25, format('matriks mencakup %s tabel public', v_tables));
end $$;

-- ---------------------------------------------------------------------------
-- Matriks RPC baca: setiap fungsi STABLE di public dipanggil sebagai B dengan id milik A
-- ---------------------------------------------------------------------------
create table test.rpc_param (name text primary key, expr text not null);
insert into test.rpc_param values
  ('p_product_id',  quote_literal('7a000000-0000-0000-0000-000000000001')),
  ('p_group_id',    quote_literal('6a000000-0000-0000-0000-000000000001')),
  ('p_ids',         quote_literal('{7a000000-0000-0000-0000-000000000001}')),
  ('p_viewed_ids',  quote_literal('{7a000000-0000-0000-0000-000000000001}')),
  ('p_capture_id',  quote_literal('ca100000-0000-0000-0000-000000000001')),
  ('p_receipt_id',  quote_literal('9a000000-0000-0000-0000-000000000001')),
  ('p_id',          quote_literal('8a000000-0000-0000-0000-000000000001')),
  ('p_from',        quote_literal('7a000000-0000-0000-0000-000000000001')),
  ('p_into',        quote_literal('70000000-0000-0000-0000-000000000200')),
  ('p_store_id',    quote_literal('2a000000-0000-0000-0000-000000000001')),
  ('p_query',       quote_literal('keripik bu siti rahasia')),
  ('p_code',        quote_literal('12345670')),
  ('p_limit',       '50'),
  ('p_top',         '50'),
  ('p_include_void','true'),
  ('p_normal_only', 'false'),
  ('p_window',      quote_literal('all')),
  ('p_window_days', 'null'),
  ('p_before_date', 'null'),
  ('p_before_id',   'null'),
  ('p_before',      'null'),
  ('p_kind',        'null');

create function test.rpc_call_sql(p_oid oid) returns text
language plpgsql as $$
declare
  v_args text := '';
  v_name text;
  v_type text;
  v_expr text;
  i int;
  p pg_proc;
begin
  select * into p from pg_proc where oid = p_oid;
  if p.proargnames is not null then
    for i in 1 .. p.pronargs loop
      v_name := p.proargnames[i];
      v_type := format_type(p.proargtypes[i - 1], null);   -- oidvector berbasis 0
      select expr into v_expr from test.rpc_param where name = v_name;
      if v_expr is null then
        raise exception 'GAGAL: parameter % pada %() belum dipetakan di 98_rls_matrix', v_name, p.proname;
      end if;
      v_args := v_args || case when v_args = '' then '' else ', ' end
                || format('%I => (%s)::%s', v_name, v_expr, v_type);
    end loop;
  end if;
  return format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]'')::text from public.%I(%s) r', p.proname, v_args);
end $$;

do $$
declare
  f        record;
  v_sql    text;
  v_out    text;
  v_leak   text;
  v_n      int := 0;
  v_seen_a int := 0;
begin
  for f in select p.oid, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and p.provolatile in ('s', 'i') and p.prorettype <> 'trigger'::regtype
            order by p.proname
  loop
    v_n := v_n + 1;
    v_sql := test.rpc_call_sql(f.oid);

    perform test.login(test.uid('b'));
    begin
      execute v_sql into v_out;
    exception when others then
      -- Hanya penolakan yang sah (NOT_FOUND, input ditolak, hak) dianggap "tidak bocor".
      if sqlstate not in ('PT404', '22023', '42501', 'PT403') then
        raise exception 'GAGAL: RPC % sebagai B error tak terduga: % %', f.proname, sqlstate, sqlerrm;
      end if;
      v_out := '';
    end;
    select string_agg(id, ', ') into v_leak from test.a_ids where strpos(v_out, id) > 0;
    perform test.ok(v_leak is null, format('RPC %s: hasil untuk B tidak memuat id A%s', f.proname,
                                           coalesce(' (bocor: ' || v_leak || ')', '')));

    perform test.login(test.uid('a'));
    begin
      execute v_sql into v_out;
      if exists (select 1 from test.a_ids where strpos(v_out, id) > 0) then v_seen_a := v_seen_a + 1; end if;
    exception when others then
      raise notice 'info: % sebagai A → %', f.proname, sqlerrm;
    end;
    perform test.logout();
  end loop;
  perform test.logout();
  perform test.ok(v_n = 0 or v_seen_a * 2 >= v_n,
                  format('matriks RPC tidak hampa: %s RPC baca, %s mengembalikan data A untuk A', v_n, v_seen_a));
end $$;
