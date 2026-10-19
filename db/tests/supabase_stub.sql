-- Stub minimal Supabase untuk menjalankan migration di PostgreSQL biasa.
-- JANGAN dijalankan di project Supabase: semua objek ini sudah disediakan Supabase.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  last_sign_in_at    timestamptz
);

-- Sama dengan perilaku auth.uid() di Supabase: baca klaim `sub` dari JWT.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
$$;

grant usage on schema auth, extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- -----------------------------------------------------------------------------
-- Storage (Tahap 4, F-14): bentuk minimal storage.buckets / storage.objects.
-- Supabase memberi hak penuh atas storage.objects ke anon/authenticated dan
-- menyerahkan pembatasan ke RLS. Stub meniru itu.
-- -----------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata   jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

-- Sama dengan storage.foldername() Supabase: semua segmen path kecuali nama file.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end $$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Default privileges ala Supabase (F-09): objek baru di schema public otomatis
-- memberi hak ke anon, authenticated, dan service_role. Migration wajib REVOKE
-- eksplisit. Test 99_privilege_inventory memeriksa hasilnya.
-- -----------------------------------------------------------------------------
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
