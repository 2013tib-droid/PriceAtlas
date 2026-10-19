-- Harness untuk db/tests/flows/*.sql. Disertakan dengan: \ir ../lib/harness.sql
-- Pola sama dengan smoke.sql: setiap pengecekan mencetak "ok  : ..." atau gagal.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;

create schema test;

create function test.ok(p_cond boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_cond is not true then raise exception 'GAGAL: %', p_label; end if;
  raise notice 'ok  : %', p_label;
end $$;

-- Gagal dengan error apa pun.
create function test.expect_error(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'GAGAL: % — seharusnya ditolak', p_label;
exception when others then
  if sqlerrm like 'GAGAL:%' then raise; end if;
  raise notice 'ok  : % (ditolak: %)', p_label, sqlerrm;
end $$;

-- Gagal dengan kode tertentu: pesan RPC (mis. 'STALE_WRITE') atau SQLSTATE (mis. '42501').
create function test.expect_code(p_sql text, p_code text, p_label text) returns void
language plpgsql as $$
declare
  v_state text; v_msg text;
begin
  execute p_sql;
  raise exception 'GAGAL: % — seharusnya ditolak dengan %', p_label, p_code;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  if v_msg like 'GAGAL:%' then raise; end if;
  if v_msg = p_code or v_state = p_code then
    raise notice 'ok  : % (%)', p_label, p_code;
  else
    raise exception 'GAGAL: % — diharapkan %, didapat % / %', p_label, p_code, v_state, v_msg;
  end if;
end $$;

-- Login sebagai user (role authenticated + klaim JWT), atau kembali ke superuser.
create function test.login(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end $$;

create function test.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'service_role', false);
end $$;

create function test.logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'none', false);
end $$;

-- Id user uji: test.uid('a') = 00000000-0000-0000-0000-00000000000a
create function test.uid(p text) returns uuid
language sql immutable as $$ select ('00000000-0000-0000-0000-00000000000' || p)::uuid $$;

-- Household milik user uji (dibaca tanpa RLS).
create function test.hh(p text) returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.household_member where user_id = test.uid(p)
$$;

grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;
