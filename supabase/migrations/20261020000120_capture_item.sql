-- =============================================================================
-- 0120 · Kandidat item observasi (D-48, D-62; docs/05 §2.2)
-- =============================================================================

create table public.capture_item (
  id                    uuid primary key default gen_random_uuid(),
  capture_id            uuid not null,
  household_id          uuid not null,
  position              smallint not null check (position >= 1),       -- "1/3" (S-11)
  image_position        smallint check (image_position >= 1),          -- gambar sumber
  region                jsonb,                                         -- crop {x,y,w,h} 0..1, opsional
  raw_text              text not null,                                 -- teks label / judul listing (calon alias)
  suggested_product_id  uuid references public.product (id),
  candidate_product_ids uuid[] not null default '{}',                  -- X-12, maks 5 (S-14)
  match_tier            text check (match_tier in ('barcode', 'alias', 'fuzzy', 'ai', 'manual')),
  match_confidence      numeric(4, 3) check (match_confidence between 0 and 1),
  store_id              uuid references public.store (id),             -- lokasi terbaca per item (logo, platform)
  branch_id             uuid,
  seller_name           text,                                          -- marketplace: seller terbaca, belum jadi branch
  seller_ref            text,
  transaction_date      date not null,                                 -- default tanggal unggah (zona household), bisa diubah (D-60)
  currency              char(3) not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  normal_price          numeric(14, 2) check (normal_price >= 0),
  promo_price           numeric(14, 2) check (promo_price >= 0),
  promo_min_qty         integer check (promo_min_qty >= 2),
  promo_valid_from      date,
  promo_valid_until     date,
  member_price          numeric(14, 2) check (member_price >= 0),
  member_program_id     uuid references public.member_program (id),
  is_bundle             boolean not null default false,
  extra                 jsonb not null default '{}'::jsonb,            -- kontrak X-10 yang sama dengan price_record
  field_confidence      jsonb not null default '{}'::jsonb,            -- per field: product, price, date, store
  status                text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  price_record_id       uuid unique references public.price_record (id) on delete set null,
  decided_by            uuid references auth.users (id) on delete set null,
  decided_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (capture_id, position),
  foreign key (capture_id, household_id) references public.capture (id, household_id) on delete cascade,
  foreign key (branch_id, store_id) references public.branch (id, store_id),
  check (store_id is not null or branch_id is null),                  -- F-06
  check (member_price is null or member_program_id is not null),
  check ((status = 'pending') = (decided_at is null)),
  check (cardinality(candidate_product_ids) <= 5),
  check (promo_valid_until is null or promo_valid_from is null or promo_valid_until >= promo_valid_from),
  constraint capture_item_field_confidence_shape
    check (app.valid_confidence_map(field_confidence, array['product', 'price', 'date', 'store']))
);
create index capture_item_capture_idx on public.capture_item (capture_id, position);
create index capture_item_pending_idx on public.capture_item (household_id) where status = 'pending';

create trigger capture_item_touch before update on public.capture_item
  for each row execute function app.touch_updated_at();
create trigger capture_item_ref_visibility before insert or update on public.capture_item
  for each row execute function app.enforce_ref_visibility('household_id',
    'suggested_product_id:product', 'store_id:store', 'branch_id:branch');

-- Item yang sudah diputuskan tidak bisa diubah. Keputusan (pending → accepted/rejected)
-- hanya lewat RPC konfirmasi, yang menyalakan penanda transaksi app.via_rpc.
-- Pengecualian: FK price_record_id → NULL saat record-nya dihapus.
create function app.capture_item_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = 'on';
begin
  if old.status <> 'pending' then
    if (to_jsonb(new) - 'price_record_id' - 'updated_at') = (to_jsonb(old) - 'price_record_id' - 'updated_at')
       and new.price_record_id is null then
      return new;
    end if;
    if not v_rpc then
      perform app.err('INVALID_STATE', jsonb_build_object('item_id', old.id, 'status', old.status));
    end if;
  end if;
  if (new.status, new.price_record_id, new.decided_at, new.decided_by)
       is distinct from (old.status, old.price_record_id, old.decided_at, old.decided_by)
     and not v_rpc then
    perform app.err('INVALID_STATE', jsonb_build_object('item_id', old.id, 'reason', 'decision_via_rpc_only'));
  end if;
  return new;
end $$;
revoke all on function app.capture_item_guard() from public, anon, authenticated;

create trigger capture_item_guard before update on public.capture_item
  for each row execute function app.capture_item_guard();

-- Audit koreksi item oleh user (§5.10).
create trigger capture_item_audit after update or delete on public.capture_item
  for each row execute function app.audit_row();

-- RLS pola HOUSEHOLD: baca dan ubah untuk anggota. Insert hanya oleh worker (service role).
alter table public.capture_item enable row level security;
create policy household_read on public.capture_item for select to authenticated
  using (household_id in (select app.my_household_ids()));
create policy household_update on public.capture_item for update to authenticated
  using      (household_id in (select app.my_household_ids()))
  with check (household_id in (select app.my_household_ids()));

-- F-09: cabut hak default Supabase, lalu beri yang dibutuhkan saja.
revoke all on public.capture_item from public, anon, authenticated;
grant select on public.capture_item to authenticated;
grant update (store_id, branch_id, seller_name, seller_ref, transaction_date, currency,
              normal_price, promo_price, promo_min_qty, promo_valid_from, promo_valid_until,
              member_price, member_program_id, is_bundle, extra, suggested_product_id,
              status, price_record_id, decided_by, decided_at)
  on public.capture_item to authenticated;
grant all on public.capture_item to service_role;
