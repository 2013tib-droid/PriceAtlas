-- =============================================================================
-- PriceAtlas — Skema Database (Tahap 2b, DRAFT)
-- =============================================================================
-- Target  : Supabase PostgreSQL (>= 15)
-- Desain  : docs/03-database-design.md
-- Domain  : docs/02-domain-model.md
--
-- File ini adalah artefak desain. Di Tahap 4 (Backend) file ini dipecah menjadi
-- migration Supabase. Validasi lokal: db/tests/run.sh
--
-- Konvensi
--   * Tabel aplikasi di schema `public` (diekspos PostgREST, dilindungi RLS).
--   * Helper, antrean, dan job di schema `app` (TIDAK diekspos ke API).
--   * household_id NULL  = baris global (milik sistem). Hanya pada tabel hybrid.
--   * Semua uang memakai numeric, tidak pernah float.
-- =============================================================================

create extension if not exists pg_trgm    with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 0. Helper umum
-- -----------------------------------------------------------------------------

-- Normalisasi teks untuk pencocokan: huruf kecil, spasi dirapikan.
create function app.normalize_text(t text) returns text
language sql immutable parallel safe
as $$ select nullif(lower(regexp_replace(btrim(t), '\s+', ' ', 'g')), '') $$;

create function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Konfigurasi aplikasi yang bisa diubah tanpa migration (D-33, D-35, D-32).
create table app.config (
  key         text primary key,
  value       jsonb not null,
  description text
);

insert into app.config (key, value, description) values
  ('best_price_window_days',        '90',  'Jendela harga terbaik utama (D-02)'),
  ('trend_window_days',             '30',  'Panjang satu jendela tren; dibandingkan dengan jendela sebelumnya'),
  ('trend_min_records_per_window',  '2',   'Data minimal per jendela agar tren ditampilkan (D-15)'),
  ('trend_flat_threshold_pct',      '2',   'Perubahan di bawah persen ini dianggap stabil'),
  ('alias_promotion_threshold',     '3',   'Jumlah household berbeda untuk promosi alias (D-35)'),
  ('image_retention_months',        '12',  'Retensi gambar capture (D-32)');

create function app.config_int(p_key text) returns integer
language sql stable
set search_path = ''
as $$ select (value #>> '{}')::integer from app.config where key = p_key $$;

-- -----------------------------------------------------------------------------
-- 1. Identity & Tenancy
-- -----------------------------------------------------------------------------

create table public.profile (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.household (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  default_currency char(3) not null default 'IDR' check (default_currency ~ '^[A-Z]{3}$'),
  timezone         text not null default 'Asia/Jakarta',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz
);

create table public.household_member (
  household_id uuid not null references public.household (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_member_user_idx on public.household_member (user_id);

-- Inti semua policy RLS: household tempat user yang login menjadi anggota.
-- SECURITY DEFINER supaya tidak rekursif terhadap RLS household_member.
create function app.my_household_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select household_id from public.household_member where user_id = (select auth.uid())
$$;
revoke all on function app.my_household_ids() from public;
grant execute on function app.my_household_ids() to authenticated, service_role;

-- Dipanggil saat signup: buat profile + household + keanggotaan owner (D-04).
create function app.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  insert into public.profile (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));

  insert into public.household (name)
  values (coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'Rumah'))
  returning id into v_household;

  insert into public.household_member (household_id, user_id, role)
  values (v_household, new.id, 'owner');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2. Validasi referensi hybrid
-- -----------------------------------------------------------------------------
-- Aturan (D-24, D-29): baris boleh merujuk baris GLOBAL atau baris milik
-- household-nya sendiri. Baris global hanya boleh merujuk baris global.
--
-- Pemakaian: trigger ... execute function app.enforce_ref_visibility(
--              '<kolom owner atau kosong>', '<kolom_fk>:<tabel>', ...)
create function app.enforce_ref_visibility() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row   jsonb := to_jsonb(new);
  v_owner uuid  := case when tg_argv[0] = '' then null else (v_row ->> tg_argv[0])::uuid end;
  v_pair  text;
  v_col   text;
  v_tbl   text;
  v_ref   uuid;
  v_ok    boolean;
begin
  foreach v_pair in array tg_argv[1:] loop
    v_col := split_part(v_pair, ':', 1);
    v_tbl := split_part(v_pair, ':', 2);
    v_ref := (v_row ->> v_col)::uuid;
    continue when v_ref is null;

    execute format(
      'select exists (select 1 from public.%I where id = $1 and (household_id is null or household_id = $2))',
      v_tbl)
    into v_ok using v_ref, v_owner;

    if not v_ok then
      raise exception 'Referensi %.% = % tidak terlihat oleh pemilik baris ini', tg_table_name, v_col, v_ref
        using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Catalog
-- -----------------------------------------------------------------------------

-- Satuan ukur (§5.2). Data referensi sistem. pack/box BUKAN satuan (§5.2).
create table public.unit (
  code           text primary key,
  name           text not null,
  dimension      text not null check (dimension in ('mass', 'volume', 'count', 'length')),
  to_base_factor numeric(18, 6) not null check (to_base_factor > 0)
);

insert into public.unit (code, name, dimension, to_base_factor) values
  ('mg',     'miligram',  'mass',   0.001),
  ('g',      'gram',      'mass',   1),
  ('kg',     'kilogram',  'mass',   1000),
  ('ml',     'mililiter', 'volume', 1),
  ('l',      'liter',     'volume', 1000),
  ('pcs',    'pcs',       'count',  1),
  ('lembar', 'lembar',    'count',  1),
  ('cm',     'sentimeter','length', 0.01),
  ('m',      'meter',     'length', 1);

create table public.brand (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid references public.household (id) on delete cascade,
  name            text not null,
  normalized_name text generated always as (app.normalize_text(name)) stored,
  status          text not null default 'active' check (status in ('active', 'merged')),
  merged_into_id  uuid references public.brand (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status = 'merged') = (merged_into_id is not null)),
  check (merged_into_id is distinct from id)
);
create unique index brand_name_uq on public.brand (household_id, normalized_name)
  nulls not distinct where status = 'active';

create table public.category (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid references public.household (id) on delete cascade,
  parent_id    uuid references public.category (id),
  slug         text,
  name         text not null,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (parent_id is distinct from id)
);
create unique index category_name_uq on public.category (household_id, app.normalize_text(name))
  nulls not distinct where archived_at is null;
create unique index category_slug_uq on public.category (slug) where household_id is null;

-- Kategori bawaan sistem (§5.8).
insert into public.category (slug, name) values
  ('makanan', 'Makanan'), ('minuman', 'Minuman'), ('bayi', 'Bayi'),
  ('rumah-tangga', 'Rumah Tangga'), ('kesehatan', 'Kesehatan'),
  ('elektronik', 'Elektronik'), ('lainnya', 'Lainnya');

create table public.product_group (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid references public.household (id) on delete cascade,
  brand_id        uuid references public.brand (id),
  category_id     uuid references public.category (id),
  name            text not null,
  normalized_name text generated always as (app.normalize_text(name)) stored,
  status          text not null default 'active' check (status in ('active', 'merged')),
  merged_into_id  uuid references public.product_group (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status = 'merged') = (merged_into_id is not null)),
  check (merged_into_id is distinct from id)
);
create index product_group_household_idx on public.product_group (household_id);

-- Product (SKU). Ukuran adalah bagian dari identitas (§5.1).
--   sale_mode = 'unit'   : pack_count × content_size content_unit (D-17).
--                          Harga di price_record = harga per 1 kemasan.
--   sale_mode = 'weight' : produk timbang (§5.3). content_size NULL,
--                          content_unit = satuan harga (mis. kg).
--                          Harga di price_record = harga per 1 content_unit.
create table public.product (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid references public.household (id) on delete cascade,
  product_group_id uuid references public.product_group (id),
  brand_id         uuid references public.brand (id),
  category_id      uuid references public.category (id),
  name             text not null,
  variant          text,
  sale_mode        text not null default 'unit' check (sale_mode in ('unit', 'weight')),
  pack_count       integer not null default 1 check (pack_count >= 1),
  content_size     numeric(12, 3) check (content_size > 0),
  content_unit     text not null references public.unit (code),
  search_text      text generated always as (app.normalize_text(name || ' ' || coalesce(variant, ''))) stored,
  status           text not null default 'active' check (status in ('active', 'merged', 'archived')),
  merged_into_id   uuid references public.product (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((sale_mode = 'unit') = (content_size is not null)),
  check (sale_mode = 'unit' or pack_count = 1),
  check ((status = 'merged') = (merged_into_id is not null)),
  check (merged_into_id is distinct from id)
);
create index product_household_idx on public.product (household_id);
create index product_group_idx     on public.product (product_group_id);
create index product_merged_idx    on public.product (merged_into_id) where merged_into_id is not null;
create index product_search_trgm   on public.product using gin (search_text extensions.gin_trgm_ops);

-- Barcode dengan periode berlaku (D-18). PLU berlaku per Store (§10).
-- household_id disalin dari product oleh trigger (tidak bisa dipalsukan klien).
create table public.barcode_assignment (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.product (id) on delete cascade,
  household_id uuid references public.household (id) on delete cascade,
  code         text not null,
  code_type    text not null check (code_type in ('gtin', 'plu')),
  store_id     uuid,
  valid_from   date not null default current_date,
  valid_until  date,
  created_at   timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from),
  check ((code_type = 'plu') = (store_id is not null)),
  check (code_type <> 'gtin' or code ~ '^[0-9]{8,14}$'),
  -- Satu kode hanya menunjuk satu produk pada satu waktu, per lingkup pemilik + toko.
  exclude using gist (
    code with =,
    (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(store_id,     '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    daterange(valid_from, valid_until, '[)') with &&
  )
);
create index barcode_code_idx    on public.barcode_assignment (code);
create index barcode_product_idx on public.barcode_assignment (product_id);

create function app.barcode_copy_owner() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  select household_id into new.household_id from public.product where id = new.product_id;
  return new;
end $$;

create trigger barcode_copy_owner
  before insert or update of product_id on public.barcode_assignment
  for each row execute function app.barcode_copy_owner();

-- -----------------------------------------------------------------------------
-- 4. Store
-- -----------------------------------------------------------------------------

create table public.store_group (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table public.store (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid references public.household (id) on delete cascade,
  store_group_id  uuid references public.store_group (id),
  name            text not null,
  normalized_name text generated always as (app.normalize_text(name)) stored,
  channel         text not null check (channel in ('offline', 'online')),
  status          text not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index store_name_uq on public.store (household_id, normalized_name) nulls not distinct;

alter table public.barcode_assignment
  add foreign key (store_id) references public.store (id);

create table public.member_program (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.store (id),
  name       text not null,
  status     text not null default 'active' check (status in ('active', 'discontinued')),
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

-- Branch = cabang fisik ATAU seller marketplace (D-06). Aggregate sendiri.
create table public.branch (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid references public.household (id) on delete cascade,
  store_id             uuid not null references public.store (id),
  kind                 text not null check (kind in ('physical', 'seller')),
  name                 text not null,
  address              text,
  city                 text,
  region               text,
  external_ref         text,           -- id/URL seller di marketplace
  status               text not null default 'open' check (status in ('open', 'closed')),
  closed_at            date,
  successor_branch_id  uuid references public.branch (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, store_id),               -- target FK komposit (branch harus milik store yang sama)
  check (successor_branch_id is distinct from id),
  check (successor_branch_id is null or status = 'closed')
);
create index branch_store_idx     on public.branch (store_id);
create index branch_household_idx on public.branch (household_id);
create unique index branch_seller_uq on public.branch (store_id, external_ref)
  where kind = 'seller' and household_id is null;

create table public.household_program_membership (
  household_id      uuid not null references public.household (id) on delete cascade,
  member_program_id uuid not null references public.member_program (id),
  created_at        timestamptz not null default now(),
  primary key (household_id, member_program_id)
);

-- Alias per Store (D-13). household_id NULL = alias global hasil promosi (D-35).
-- Alias household sendiri berfungsi sebagai "konfirmasi" untuk promosi, jadi
-- entity Alias Confirmation dari Tahap 2a tidak perlu tabel terpisah.
create table public.product_alias (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid references public.household (id) on delete cascade,
  store_id        uuid not null references public.store (id),
  product_id      uuid not null references public.product (id),
  alias_text      text not null,
  normalized_text text generated always as (app.normalize_text(alias_text)) stored,
  status          text not null default 'active' check (status in ('active', 'revoked')),
  promoted_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index product_alias_uq on public.product_alias (store_id, normalized_text, household_id)
  nulls not distinct where status = 'active';
create index product_alias_product_idx on public.product_alias (product_id);

-- -----------------------------------------------------------------------------
-- 5. Capture & Processing
-- -----------------------------------------------------------------------------

create table public.shopping_session (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  branch_id    uuid not null references public.branch (id),
  started_by   uuid references auth.users (id) on delete set null,
  started_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '4 hours',
  ended_at     timestamptz,
  unique (id, household_id),
  check (expires_at > started_at),
  check (ended_at is null or ended_at >= started_at)
);
create index shopping_session_active_idx on public.shopping_session (household_id, started_at desc)
  where ended_at is null;

create table public.capture (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.household (id) on delete cascade,
  kind                text not null check (kind in ('receipt', 'price_label', 'marketplace')),
  status              text not null default 'uploaded'
                      check (status in ('uploaded', 'processing', 'needs_confirmation', 'done', 'failed')),
  shopping_session_id uuid,
  store_id            uuid references public.store (id),     -- pilihan manual (D-11)
  branch_id           uuid,
  uploaded_by         uuid references auth.users (id) on delete set null,
  uploaded_at         timestamptz not null default now(),
  processed_at        timestamptz,
  error_message       text,
  unique (id, household_id),
  foreign key (shopping_session_id, household_id)
    references public.shopping_session (id, household_id) on delete set null (shopping_session_id),
  foreign key (branch_id, store_id) references public.branch (id, store_id)
);
create index capture_household_idx on public.capture (household_id, uploaded_at desc);
create index capture_pending_idx   on public.capture (status, uploaded_at)
  where status in ('uploaded', 'processing');

-- Path storage: captures/{household_id}/{capture_id}/{position}.{ext}
create table public.capture_image (
  id           uuid primary key default gen_random_uuid(),
  capture_id   uuid not null,
  household_id uuid not null,
  position     smallint not null check (position >= 1),
  storage_path text not null,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size    integer check (byte_size > 0),
  created_at   timestamptz not null default now(),
  purge_after  timestamptz not null default now() + interval '12 months',  -- D-32
  purged_at    timestamptz,
  unique (capture_id, position),
  foreign key (capture_id, household_id) references public.capture (id, household_id) on delete cascade
);
create index capture_image_hash_idx  on public.capture_image (household_id, sha256);
create index capture_image_purge_idx on public.capture_image (purge_after) where purged_at is null;

-- Satu percobaan OCR + AI. Data mentah disimpan untuk proses ulang dan audit (§3).
create table public.processing_run (
  id              uuid primary key default gen_random_uuid(),
  capture_id      uuid not null,
  household_id    uuid not null,
  status          text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  ocr_engine      text,
  ai_model        text,
  prompt_version  text,
  raw_ocr_text    text,
  raw_ai_output   jsonb,
  input_tokens    integer,
  output_tokens   integer,
  cost_usd        numeric(12, 6),
  error_message   text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  pii_redacted_at timestamptz,                                              -- D-32
  foreign key (capture_id, household_id) references public.capture (id, household_id) on delete cascade
);
create index processing_run_capture_idx on public.processing_run (capture_id, started_at desc);

-- -----------------------------------------------------------------------------
-- 6. Receipt
-- -----------------------------------------------------------------------------

create table public.receipt (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.household (id) on delete cascade,
  capture_id             uuid unique,
  store_id               uuid not null references public.store (id),
  branch_id              uuid,
  transaction_date       date not null,
  transaction_time       time,
  currency               char(3) not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  subtotal_amount        numeric(14, 2),
  total_amount           numeric(14, 2) not null,
  payment_method         text,
  pii                    jsonb not null default '{}'::jsonb,  -- digit kartu, nama/nomor member, HP (§6)
  status                 text not null default 'draft' check (status in ('draft', 'confirmed', 'discarded')),
  duplicate_of_receipt_id uuid,
  confirmed_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, household_id),
  foreign key (capture_id, household_id) references public.capture (id, household_id) on delete set null (capture_id),
  foreign key (duplicate_of_receipt_id, household_id)
    references public.receipt (id, household_id) on delete set null (duplicate_of_receipt_id),
  foreign key (branch_id, store_id) references public.branch (id, store_id)
);
-- Sidik jari duplikat: toko + tanggal + total (D-20).
create index receipt_fingerprint_idx on public.receipt (household_id, store_id, transaction_date, total_amount);
create index receipt_household_idx   on public.receipt (household_id, transaction_date desc);

-- Baris struk apa adanya (D-23).
--   line_type 'product'  : quantity × unit_amount = line_amount. Produk timbang:
--                          quantity = berat, unit_amount = harga per satuan berat.
--   'discount' / 'void'  : amount negatif, applies_to_line_id = baris yang dikenai.
create table public.receipt_line (
  id                   uuid primary key default gen_random_uuid(),
  receipt_id           uuid not null,
  household_id         uuid not null,
  line_no              smallint not null check (line_no >= 1),
  line_type            text not null check (line_type in ('product', 'discount', 'void', 'non_product', 'tax', 'other')),
  raw_text             text not null,
  quantity             numeric(12, 3) check (quantity > 0),
  unit_amount          numeric(14, 2),
  line_amount          numeric(14, 2) not null,
  applies_to_line_id   uuid,
  suggested_product_id uuid references public.product (id),
  match_tier           text check (match_tier in ('barcode', 'alias', 'fuzzy', 'ai', 'manual')),
  match_confidence     numeric(4, 3) check (match_confidence between 0 and 1),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (receipt_id, line_no) deferrable initially deferred,
  unique (id, receipt_id),
  unique (id, household_id),
  foreign key (receipt_id, household_id) references public.receipt (id, household_id) on delete cascade,
  foreign key (applies_to_line_id, receipt_id) references public.receipt_line (id, receipt_id) on delete cascade,
  check (applies_to_line_id is distinct from id),
  check (line_type not in ('discount', 'void') or applies_to_line_id is not null)
);

-- Voucher / cashback / poin level struk (D-01, D-14). Tidak dialokasikan ke item.
create table public.receipt_adjustment (
  id           uuid primary key default gen_random_uuid(),
  receipt_id   uuid not null,
  household_id uuid not null,
  kind         text not null check (kind in ('voucher', 'cashback', 'points', 'shipping', 'other')),
  description  text,
  amount       numeric(14, 2),
  points       numeric(14, 2),
  created_at   timestamptz not null default now(),
  foreign key (receipt_id, household_id) references public.receipt (id, household_id) on delete cascade,
  check (amount is not null or points is not null)
);
create index receipt_adjustment_receipt_idx on public.receipt_adjustment (receipt_id);

-- -----------------------------------------------------------------------------
-- 7. Price Record (D-22)
-- -----------------------------------------------------------------------------
-- Satu titik histori harga. Arti angka harga:
--   produk 'unit'   : *_price = harga per 1 kemasan (bukan per baris struk).
--   produk 'weight' : *_price = harga per 1 content_unit produk (mis. per kg);
--                     actual_weight = berat yang dibeli/diamati.
-- effective_price  : harga per kemasan/satuan setelah diskon item (D-01),
--                    atau harga terendah yang berlaku untuk household (D-26, D-27).
--                    Dihitung aplikasi saat record dibuat.
-- unit_price       : effective_price per satuan dasar (g / ml / pcs / m).
--                    SELALU dihitung trigger dari data produk (nilai turunan).
create table public.price_record (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.household (id) on delete cascade,
  product_id        uuid not null references public.product (id),
  store_id          uuid not null references public.store (id),
  branch_id         uuid,                                               -- D-28
  source_type       text not null check (source_type in ('receipt', 'price_label', 'marketplace')),
  receipt_line_id   uuid unique,
  capture_id        uuid,
  transaction_date  date not null,
  currency          char(3) not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  quantity          numeric(12, 3) not null default 1 check (quantity > 0),
  actual_weight     numeric(12, 3) check (actual_weight > 0),
  normal_price      numeric(14, 2) check (normal_price >= 0),
  promo_price       numeric(14, 2) check (promo_price >= 0),
  promo_min_qty     integer check (promo_min_qty >= 2),                 -- D-34
  promo_valid_from  date,
  promo_valid_until date,
  member_price      numeric(14, 2) check (member_price >= 0),
  member_program_id uuid references public.member_program (id),
  effective_price   numeric(14, 2) not null check (effective_price >= 0),
  price_basis       text not null check (price_basis in ('normal', 'promo', 'member')),
  unit_price        numeric(18, 6) not null,
  is_bundle         boolean not null default false,                     -- D-08
  visibility        text not null default 'private' check (visibility in ('private', 'public')),  -- D-07
  status            text not null default 'active' check (status in ('active', 'void')),
  extra             jsonb not null default '{}'::jsonb,                 -- cashback, ongkir, catatan (D-14, D-36)
  match_tier        text check (match_tier in ('barcode', 'alias', 'fuzzy', 'ai', 'manual')),
  match_confidence  numeric(4, 3) check (match_confidence between 0 and 1),
  match_outcome     text check (match_outcome in ('auto', 'confirmed', 'corrected')),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (receipt_line_id, household_id) references public.receipt_line (id, household_id) on delete cascade,
  foreign key (capture_id, household_id)      references public.capture (id, household_id) on delete set null (capture_id),
  foreign key (branch_id, store_id)           references public.branch (id, store_id),
  check ((source_type = 'receipt') = (receipt_line_id is not null)),
  check (member_price is null or member_program_id is not null),
  check (price_basis <> 'promo'  or promo_price  is not null),
  check (price_basis <> 'member' or member_price is not null),
  check (promo_valid_until is null or promo_valid_from is null or promo_valid_until >= promo_valid_from)
);
-- Jalur utama: histori & harga terbaik per (household, produk).
create index price_record_hist_idx on public.price_record (household_id, product_id, transaction_date desc)
  include (unit_price, effective_price, price_basis, store_id, branch_id)
  where status = 'active';
create index price_record_recent_idx  on public.price_record (household_id, transaction_date desc);
create index price_record_product_idx on public.price_record (product_id);           -- merge & recompute global
create index price_record_capture_idx on public.price_record (capture_id) where capture_id is not null;

create function app.compute_unit_price() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_mode   text;
  v_pack   integer;
  v_size   numeric;
  v_factor numeric;
begin
  select p.sale_mode, p.pack_count, p.content_size, u.to_base_factor
    into v_mode, v_pack, v_size, v_factor
    from public.product p
    join public.unit u on u.code = p.content_unit
   where p.id = new.product_id;

  new.unit_price := case v_mode
    when 'unit'   then new.effective_price / (v_pack * v_size * v_factor)
    when 'weight' then new.effective_price / v_factor
  end;
  return new;
end $$;

create trigger price_record_unit_price
  before insert or update on public.price_record
  for each row execute function app.compute_unit_price();

-- Price Record pembelian diturunkan dari Receipt (D-23): koreksi header struk
-- ikut mengalir ke record-nya.
create function app.propagate_receipt_header() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.price_record pr
     set transaction_date = new.transaction_date,
         store_id         = new.store_id,
         branch_id        = new.branch_id,
         currency         = new.currency
    from public.receipt_line rl
   where rl.receipt_id = new.id
     and pr.receipt_line_id = rl.id;
  return null;
end $$;

create trigger receipt_propagate_header
  after update of transaction_date, store_id, branch_id, currency on public.receipt
  for each row execute function app.propagate_receipt_header();

-- -----------------------------------------------------------------------------
-- 8. Read model: Price Summary (D-31) & Public Price Fact (D-25)
-- -----------------------------------------------------------------------------

create table public.price_summary (
  household_id            uuid not null references public.household (id) on delete cascade,
  product_id              uuid not null references public.product (id) on delete cascade,
  record_count            integer not null,
  last_transaction_date   date not null,
  last_effective_price    numeric(14, 2) not null,
  last_unit_price         numeric(18, 6) not null,
  best_90d_record_id      uuid,
  best_90d_unit_price     numeric(18, 6),
  best_90d_effective_price numeric(14, 2),
  best_90d_price_basis    text,
  best_90d_date           date,
  best_90d_store_id       uuid,
  best_90d_branch_id      uuid,
  best_all_record_id      uuid not null,
  best_all_unit_price     numeric(18, 6) not null,
  best_all_effective_price numeric(14, 2) not null,
  best_all_price_basis    text not null,
  best_all_date           date not null,
  best_all_store_id       uuid not null,
  best_all_branch_id      uuid,
  trend_direction         text check (trend_direction in ('up', 'down', 'flat')),
  trend_pct               numeric(8, 2),
  as_of_date              date not null,
  refreshed_at            timestamptz not null default now(),
  primary key (household_id, product_id)
);
-- Tidak ada FK ke price_record: read model, selalu bisa dibangun ulang.

create table app.summary_refresh_queue (
  household_id uuid not null,
  product_id   uuid not null,
  enqueued_at  timestamptz not null default now(),
  primary key (household_id, product_id)
);

create function app.enqueue_summary_refresh() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    insert into app.summary_refresh_queue (household_id, product_id)
    values (old.household_id, old.product_id) on conflict do nothing;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into app.summary_refresh_queue (household_id, product_id)
    values (new.household_id, new.product_id) on conflict do nothing;
  end if;
  return null;
end $$;

create trigger price_record_enqueue_summary
  after insert or update or delete on public.price_record
  for each row execute function app.enqueue_summary_refresh();

-- Hitung ulang satu ringkasan. Harga terbaik = unit_price terendah dari record
-- aktif non-bundle; seri dipecahkan oleh tanggal terbaru (D-02, D-08).
-- Tren = rata-rata unit_price jendela terakhir vs jendela sebelumnya (D-33).
create function app.refresh_price_summary(p_household uuid, p_product uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today   date    := current_date;
  v_window  integer := app.config_int('best_price_window_days');
  v_tw      integer := app.config_int('trend_window_days');
  v_tmin    integer := app.config_int('trend_min_records_per_window');
  v_tflat   numeric := app.config_int('trend_flat_threshold_pct');
  v_count   integer;
  v_last    record;
  v_b90     record;
  v_ball    record;
  v_cur_avg numeric; v_cur_n integer;
  v_prv_avg numeric; v_prv_n integer;
  v_pct     numeric;
  v_dir     text;
begin
  select count(*) into v_count
    from public.price_record
   where household_id = p_household and product_id = p_product
     and status = 'active' and not is_bundle;

  if v_count = 0 then
    delete from public.price_summary where household_id = p_household and product_id = p_product;
    return;
  end if;

  select * into v_last from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle
   order by transaction_date desc, created_at desc limit 1;

  select * into v_ball from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle
   order by unit_price asc, transaction_date desc limit 1;

  select * into v_b90 from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle
     and transaction_date > v_today - v_window
   order by unit_price asc, transaction_date desc limit 1;

  select avg(unit_price), count(*) into v_cur_avg, v_cur_n from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle
     and transaction_date >  v_today - v_tw;
  select avg(unit_price), count(*) into v_prv_avg, v_prv_n from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle
     and transaction_date <= v_today - v_tw and transaction_date > v_today - 2 * v_tw;

  if v_cur_n >= v_tmin and v_prv_n >= v_tmin and v_prv_avg > 0 then
    v_pct := round((v_cur_avg - v_prv_avg) / v_prv_avg * 100, 2);
    v_dir := case when v_pct >= v_tflat then 'up' when v_pct <= -v_tflat then 'down' else 'flat' end;
  end if;

  insert into public.price_summary as s (
    household_id, product_id, record_count,
    last_transaction_date, last_effective_price, last_unit_price,
    best_90d_record_id, best_90d_unit_price, best_90d_effective_price, best_90d_price_basis,
    best_90d_date, best_90d_store_id, best_90d_branch_id,
    best_all_record_id, best_all_unit_price, best_all_effective_price, best_all_price_basis,
    best_all_date, best_all_store_id, best_all_branch_id,
    trend_direction, trend_pct, as_of_date, refreshed_at)
  values (
    p_household, p_product, v_count,
    v_last.transaction_date, v_last.effective_price, v_last.unit_price,
    v_b90.id, v_b90.unit_price, v_b90.effective_price, v_b90.price_basis,
    v_b90.transaction_date, v_b90.store_id, v_b90.branch_id,
    v_ball.id, v_ball.unit_price, v_ball.effective_price, v_ball.price_basis,
    v_ball.transaction_date, v_ball.store_id, v_ball.branch_id,
    v_dir, v_pct, v_today, now())
  on conflict (household_id, product_id) do update set
    record_count = excluded.record_count,
    last_transaction_date = excluded.last_transaction_date,
    last_effective_price = excluded.last_effective_price,
    last_unit_price = excluded.last_unit_price,
    best_90d_record_id = excluded.best_90d_record_id,
    best_90d_unit_price = excluded.best_90d_unit_price,
    best_90d_effective_price = excluded.best_90d_effective_price,
    best_90d_price_basis = excluded.best_90d_price_basis,
    best_90d_date = excluded.best_90d_date,
    best_90d_store_id = excluded.best_90d_store_id,
    best_90d_branch_id = excluded.best_90d_branch_id,
    best_all_record_id = excluded.best_all_record_id,
    best_all_unit_price = excluded.best_all_unit_price,
    best_all_effective_price = excluded.best_all_effective_price,
    best_all_price_basis = excluded.best_all_price_basis,
    best_all_date = excluded.best_all_date,
    best_all_store_id = excluded.best_all_store_id,
    best_all_branch_id = excluded.best_all_branch_id,
    trend_direction = excluded.trend_direction,
    trend_pct = excluded.trend_pct,
    as_of_date = excluded.as_of_date,
    refreshed_at = excluded.refreshed_at;
end $$;

-- Dipanggil worker / pg_cron tiap beberapa detik. Aman dijalankan paralel.
create function app.process_summary_queue(p_limit integer default 500) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item record;
  v_n    integer := 0;
begin
  for v_item in
    delete from app.summary_refresh_queue q
     where (q.household_id, q.product_id) in (
       select household_id, product_id from app.summary_refresh_queue
        order by enqueued_at limit p_limit for update skip locked)
    returning q.household_id, q.product_id
  loop
    perform app.refresh_price_summary(v_item.household_id, v_item.product_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Job harian (K-1 / D-31): ringkasan yang berubah hanya karena waktu bergeser.
create function app.enqueue_time_based_refresh() returns integer
language sql security definer
set search_path = ''
as $$
  with ins as (
    insert into app.summary_refresh_queue (household_id, product_id)
    select household_id, product_id
      from public.price_summary
     where as_of_date < current_date
       and (   best_90d_date <= current_date - app.config_int('best_price_window_days')
            or trend_direction is not null
            or last_transaction_date > current_date - 2 * app.config_int('trend_window_days'))
    on conflict do nothing
    returning 1)
  select count(*)::integer from ins
$$;

-- Proyeksi publik anonim (D-25). TIDAK ada household_id, tidak ada timestamp.
create table public.public_price_fact (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.product (id) on delete cascade,
  store_id         uuid not null references public.store (id),
  branch_id        uuid references public.branch (id),
  transaction_date date not null,
  currency         char(3) not null,
  effective_price  numeric(14, 2) not null,
  unit_price       numeric(18, 6) not null,
  price_basis      text not null,
  source_type      text not null
);
create index public_price_fact_product_idx on public.public_price_fact (product_id, transaction_date desc);

-- Tautan ke record asal hanya di schema app (tidak terbaca klien), dipakai saat opt-out.
create table app.public_price_source (
  fact_id         uuid primary key references public.public_price_fact (id) on delete cascade,
  price_record_id uuid not null unique references public.price_record (id) on delete cascade
);

create function app.sync_public_fact() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.public_price_fact f
     using app.public_price_source s
     where s.fact_id = f.id and s.price_record_id = old.id;
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and new.visibility = 'public' and new.status = 'active' and not new.is_bundle
     -- hanya katalog global: produk/toko privat bisa mengungkap identitas
     and exists (select 1 from public.product where id = new.product_id and household_id is null)
     and exists (select 1 from public.store   where id = new.store_id   and household_id is null)
     and (new.branch_id is null
          or exists (select 1 from public.branch where id = new.branch_id and household_id is null))
  then
    with f as (
      insert into public.public_price_fact
        (product_id, store_id, branch_id, transaction_date, currency,
         effective_price, unit_price, price_basis, source_type)
      values
        (new.product_id, new.store_id, new.branch_id, new.transaction_date, new.currency,
         new.effective_price, new.unit_price, new.price_basis, new.source_type)
      returning id)
    insert into app.public_price_source (fact_id, price_record_id)
    select id, new.id from f;
  end if;
  return null;
end $$;

create trigger price_record_sync_public
  after insert or update or delete on public.price_record
  for each row execute function app.sync_public_fact();

-- -----------------------------------------------------------------------------
-- 9. Audit Log (§5.10)
-- -----------------------------------------------------------------------------
-- Append-only. Hanya perubahan oleh user (auth.uid() terisi) yang dicatat;
-- hitung ulang otomatis oleh sistem bukan "koreksi".
create table public.audit_log (
  id           bigint generated always as identity primary key,
  household_id uuid not null references public.household (id) on delete cascade,
  actor_id     uuid references auth.users (id) on delete set null,
  entity_type  text not null,
  entity_id    uuid not null,
  action       text not null check (action in ('update', 'delete', 'merge')),
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);
create index audit_log_entity_idx    on public.audit_log (entity_type, entity_id, created_at desc);
create index audit_log_household_idx on public.audit_log (household_id, created_at desc);

create function app.audit_row() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_household uuid := coalesce(to_jsonb(new) ->> 'household_id', to_jsonb(old) ->> 'household_id')::uuid;
begin
  if (select auth.uid()) is null or v_household is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
    return null;
  end if;
  insert into public.audit_log (household_id, actor_id, entity_type, entity_id, action, before, after)
  values (v_household, (select auth.uid()), tg_table_name,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id')::uuid,
          lower(tg_op), to_jsonb(old),
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- 10. Job latar belakang
-- -----------------------------------------------------------------------------
create table app.job (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('recompute_unit_price', 'promote_aliases',
                                               'purge_images', 'redact_ocr')),
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts     integer not null default 0,
  run_after    timestamptz not null default now(),
  last_error   text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index job_pending_idx on app.job (run_after) where status = 'pending';

-- Ukuran produk berubah → unit_price semua record produk itu basi (B-2).
-- Dikerjakan async karena produk global bisa punya jutaan record.
create function app.enqueue_unit_price_recompute() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into app.job (kind, payload)
  values ('recompute_unit_price', jsonb_build_object('product_id', new.id));
  return null;
end $$;

create trigger product_size_changed
  after update of sale_mode, pack_count, content_size, content_unit on public.product
  for each row execute function app.enqueue_unit_price_recompute();

-- Dipanggil berulang oleh worker sampai mengembalikan 0.
create function app.recompute_unit_prices(p_product uuid, p_batch integer default 5000) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with batch as (
    select pr.id from public.price_record pr
      join public.product p on p.id = pr.product_id
      join public.unit u on u.code = p.content_unit
     where pr.product_id = p_product
       and pr.unit_price is distinct from case p.sale_mode
             when 'unit'   then pr.effective_price / (p.pack_count * p.content_size * u.to_base_factor)
             when 'weight' then pr.effective_price / u.to_base_factor end
     limit p_batch)
  update public.price_record pr set updated_at = now()   -- trigger menghitung ulang unit_price
    from batch where pr.id = batch.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Promosi alias household ke global (D-35).
create function app.promote_aliases() returns integer
language sql security definer
set search_path = ''
as $$
  with candidate as (
    select a.store_id, a.normalized_text,
           min(a.alias_text)              as alias_text,
           (array_agg(a.product_id))[1]   as product_id
      from public.product_alias a
      join public.product p on p.id = a.product_id
     where a.household_id is not null and a.status = 'active'
     group by a.store_id, a.normalized_text
    having count(distinct a.product_id) = 1                                   -- tanpa pemetaan tandingan
       and count(distinct a.household_id) >= app.config_int('alias_promotion_threshold')
       and bool_and(p.household_id is null)                                   -- hanya produk global
  ), ins as (
    insert into public.product_alias (household_id, store_id, product_id, alias_text, promoted_at)
    select null, c.store_id, c.product_id, c.alias_text, now()
      from candidate c
     where not exists (
       select 1 from public.product_alias g
        where g.household_id is null and g.status = 'active'
          and g.store_id = c.store_id and g.normalized_text = c.normalized_text)
    returning 1)
  select count(*)::integer from ins
$$;

-- -----------------------------------------------------------------------------
-- 11. Merge produk (D-21, D-30)
-- -----------------------------------------------------------------------------
-- Invariant: target merge harus 'active' → tidak mungkin terbentuk siklus.
-- Rantai dipadatkan: semua yang menunjuk ke produk lama dialihkan ke target.
create function app.check_product_merge() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'merged' and old.status is distinct from 'merged' then
    if not exists (select 1 from public.product where id = new.merged_into_id and status = 'active') then
      raise exception 'Target merge % harus produk aktif', new.merged_into_id;
    end if;
  end if;
  return new;
end $$;

create trigger product_check_merge
  before update of status, merged_into_id on public.product
  for each row execute function app.check_product_merge();

-- RPC: merge produk. Produk privat oleh anggota household-nya; produk global
-- hanya oleh sistem (service role, auth.uid() kosong).
create function public.merge_product(p_from uuid, p_into uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from public.product;
  v_into public.product;
  v_uid  uuid := (select auth.uid());
begin
  select * into v_from from public.product where id = p_from for update;
  select * into v_into from public.product where id = p_into for update;

  if v_from.id is null or v_into.id is null then
    raise exception 'Produk tidak ditemukan';
  end if;
  if v_uid is not null and (v_from.household_id is null
       or v_from.household_id not in (select app.my_household_ids())) then
    raise exception 'Tidak berhak me-merge produk ini' using errcode = 'insufficient_privilege';
  end if;
  if v_into.household_id is not null and v_into.household_id is distinct from v_from.household_id then
    raise exception 'Target merge harus produk global atau milik household yang sama';
  end if;

  update public.product set status = 'merged', merged_into_id = p_into where id = p_from;
  update public.product set merged_into_id = p_into where merged_into_id = p_from;   -- padatkan rantai

  update public.product_alias      set product_id = p_into where product_id = p_from;
  update public.barcode_assignment set product_id = p_into where product_id = p_from;
  update public.price_record       set product_id = p_into where product_id = p_from;
  delete from public.price_summary where product_id = p_from;

  if v_uid is not null then
    insert into public.audit_log (household_id, actor_id, entity_type, entity_id, action, before, after)
    values (v_from.household_id, v_uid, 'product', p_from, 'merge',
            to_jsonb(v_from), jsonb_build_object('merged_into_id', p_into));
  end if;
end $$;
revoke all on function public.merge_product(uuid, uuid) from public, anon;
grant execute on function public.merge_product(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 12. Metrik kualitas AI (§6) — hanya untuk admin
-- -----------------------------------------------------------------------------
create view app.match_quality_daily as
select created_at::date            as day,
       source_type,
       match_tier,
       count(*)                                          as total,
       count(*) filter (where match_outcome = 'auto')      as auto_matched,
       count(*) filter (where match_outcome = 'confirmed') as confirmed,
       count(*) filter (where match_outcome = 'corrected') as corrected
  from public.price_record
 group by 1, 2, 3;

-- -----------------------------------------------------------------------------
-- 13. Trigger pemasangan: updated_at, visibilitas referensi, audit
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profile', 'household', 'brand', 'product_group', 'product', 'store',
                           'branch', 'product_alias', 'receipt', 'receipt_line', 'price_record'] loop
    execute format('create trigger %I before update on public.%I
                    for each row execute function app.touch_updated_at()', t || '_touch', t);
  end loop;

  foreach t in array array['price_record', 'receipt', 'receipt_line', 'receipt_adjustment',
                           'product', 'product_group', 'brand', 'category', 'store', 'branch',
                           'product_alias', 'barcode_assignment'] loop
    execute format('create trigger %I after update or delete on public.%I
                    for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;

create trigger category_ref_visibility before insert or update on public.category
  for each row execute function app.enforce_ref_visibility('household_id', 'parent_id:category');
create trigger product_group_ref_visibility before insert or update on public.product_group
  for each row execute function app.enforce_ref_visibility('household_id', 'brand_id:brand', 'category_id:category');
create trigger product_ref_visibility before insert or update on public.product
  for each row execute function app.enforce_ref_visibility('household_id',
    'product_group_id:product_group', 'brand_id:brand', 'category_id:category', 'merged_into_id:product');
create trigger barcode_ref_visibility before insert or update on public.barcode_assignment
  for each row execute function app.enforce_ref_visibility('household_id', 'store_id:store');
create trigger member_program_ref_visibility before insert or update on public.member_program
  for each row execute function app.enforce_ref_visibility('', 'store_id:store');
create trigger branch_ref_visibility before insert or update on public.branch
  for each row execute function app.enforce_ref_visibility('household_id', 'store_id:store', 'successor_branch_id:branch');
create trigger product_alias_ref_visibility before insert or update on public.product_alias
  for each row execute function app.enforce_ref_visibility('household_id', 'store_id:store', 'product_id:product');
create trigger shopping_session_ref_visibility before insert or update on public.shopping_session
  for each row execute function app.enforce_ref_visibility('household_id', 'branch_id:branch');
create trigger capture_ref_visibility before insert or update on public.capture
  for each row execute function app.enforce_ref_visibility('household_id', 'store_id:store', 'branch_id:branch');
create trigger receipt_ref_visibility before insert or update on public.receipt
  for each row execute function app.enforce_ref_visibility('household_id', 'store_id:store', 'branch_id:branch');
create trigger receipt_line_ref_visibility before insert or update on public.receipt_line
  for each row execute function app.enforce_ref_visibility('household_id', 'suggested_product_id:product');
create trigger price_record_ref_visibility before insert or update on public.price_record
  for each row execute function app.enforce_ref_visibility('household_id',
    'product_id:product', 'store_id:store', 'branch_id:branch');

-- -----------------------------------------------------------------------------
-- 14. Row Level Security
-- -----------------------------------------------------------------------------
-- Pola (lihat docs/03-database-design.md §5):
--   HOUSEHOLD : baca/tulis jika household_id ∈ my_household_ids()
--   HYBRID    : baca jika global ATAU milik saya; tulis hanya baris milik saya
--   SYSTEM    : baca semua user login; tulis hanya service role (bypass RLS)
--   READ-ONLY : baca milik saya; tulis hanya oleh fungsi sistem

do $$
declare t text;
begin
  -- semua tabel public memakai RLS
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- HOUSEHOLD: CRUD penuh untuk anggota
  foreach t in array array['household_program_membership', 'shopping_session', 'capture',
                           'capture_image', 'processing_run', 'receipt', 'receipt_line',
                           'receipt_adjustment', 'price_record'] loop
    execute format($p$
      create policy household_rw on public.%I for all to authenticated
        using      (household_id in (select app.my_household_ids()))
        with check (household_id in (select app.my_household_ids()))$p$, t);
  end loop;

  -- HYBRID: global terbaca semua, privat hanya pemiliknya; global tidak bisa ditulis user
  foreach t in array array['brand', 'category', 'product_group', 'product', 'barcode_assignment',
                           'store', 'branch', 'product_alias'] loop
    execute format($p$
      create policy hybrid_read on public.%I for select to authenticated
        using (household_id is null or household_id in (select app.my_household_ids()))$p$, t);
    execute format($p$
      create policy hybrid_insert on public.%I for insert to authenticated
        with check (household_id in (select app.my_household_ids()))$p$, t);
    execute format($p$
      create policy hybrid_update on public.%I for update to authenticated
        using      (household_id in (select app.my_household_ids()))
        with check (household_id in (select app.my_household_ids()))$p$, t);
    execute format($p$
      create policy hybrid_delete on public.%I for delete to authenticated
        using (household_id in (select app.my_household_ids()))$p$, t);
  end loop;

  -- SYSTEM: data referensi
  foreach t in array array['unit', 'store_group', 'member_program'] loop
    execute format('create policy system_read on public.%I for select to authenticated using (true)', t);
  end loop;

  -- READ-ONLY untuk anggota household
  foreach t in array array['price_summary', 'audit_log'] loop
    execute format($p$
      create policy household_read on public.%I for select to authenticated
        using (household_id in (select app.my_household_ids()))$p$, t);
  end loop;
end $$;

-- Tenancy
create policy member_read on public.household for select to authenticated
  using (id in (select app.my_household_ids()));
create policy owner_update on public.household for update to authenticated
  using (id in (select household_id from public.household_member
                 where user_id = (select auth.uid()) and role = 'owner'));

create policy member_read on public.household_member for select to authenticated
  using (household_id in (select app.my_household_ids()));

create policy self_or_comember_read on public.profile for select to authenticated
  using (user_id = (select auth.uid())
         or user_id in (select user_id from public.household_member
                         where household_id in (select app.my_household_ids())));
create policy self_update on public.profile for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Publik: siapa pun (termasuk anon) boleh membaca fakta harga anonim
create policy public_read on public.public_price_fact for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- 15. Hak akses tabel (lapisan kedua di bawah RLS)
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all tables    in schema app    from anon, authenticated;
revoke all on all functions in schema app    from public, anon, authenticated;
grant execute on function app.my_household_ids() to authenticated;
grant execute on function app.normalize_text(text) to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.unit, public.store_group, public.member_program,
                                 public.price_summary, public.public_price_fact, public.audit_log,
                                 public.household_member from authenticated;
revoke insert, delete on public.household, public.profile from authenticated;
grant select on public.public_price_fact, public.unit to anon;

grant all on all tables    in schema public to service_role;
grant all on all tables    in schema app    to service_role;
grant all on all sequences in schema public to service_role;
grant all on all sequences in schema app    to service_role;
grant execute on all functions in schema app to service_role;
