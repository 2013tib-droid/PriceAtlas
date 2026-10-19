-- =============================================================================
-- 0200 · Perbaikan F-01 (merge barcode) dan F-02 (fakta publik yatim) — D-65
-- =============================================================================

-- F-01: merge privat → global tidak memindahkan barcode privat. Barcode itu tetap
-- menempel di produk lama (status merged); matching tier 1 dan R6 mengikuti
-- merged_into_id. Barcode hanya dipindah jika pemilik kedua produk sama
-- (sama-sama milik household yang sama, atau sama-sama global).
create or replace function public.merge_product(p_from uuid, p_into uuid) returns void
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

  update public.product_alias set product_id = p_into where product_id = p_from;
  if v_from.household_id is not distinct from v_into.household_id then
    update public.barcode_assignment set product_id = p_into where product_id = p_from;
  end if;
  update public.price_record set product_id = p_into where product_id = p_from;
  delete from public.price_summary where product_id = p_from;

  if v_uid is not null then
    insert into public.audit_log (household_id, actor_id, entity_type, entity_id, action, before, after)
    values (v_from.household_id, v_uid, 'product', p_from, 'merge',
            to_jsonb(v_from), jsonb_build_object('merged_into_id', p_into));
  end if;
end $$;

-- F-02: hapus fakta publik di BEFORE DELETE, saat tautan app.public_price_source
-- masih ada. Bagian INSERT/UPDATE tetap di trigger AFTER yang lama.
create function app.unsync_public_fact() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.public_price_fact f
   using app.public_price_source s
   where s.fact_id = f.id and s.price_record_id = old.id;
  return old;
end $$;
revoke all on function app.unsync_public_fact() from public, anon, authenticated;

drop trigger price_record_sync_public on public.price_record;
create trigger price_record_sync_public
  after insert or update on public.price_record
  for each row execute function app.sync_public_fact();
create trigger price_record_unsync_public
  before delete on public.price_record
  for each row execute function app.unsync_public_fact();

-- D-65 / Q-06: hapus akun mempertahankan fakta anonim. Tautan dilepas lebih dulu,
-- sehingga cascade penghapusan record tidak lagi menemukan faktanya.
create function app.detach_public_facts(p_household uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from app.public_price_source s
   using public.price_record pr
   where pr.id = s.price_record_id and pr.household_id = p_household;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function app.detach_public_facts(uuid) from public, anon, authenticated;
grant execute on function app.detach_public_facts(uuid) to service_role;

grant execute on all functions in schema app to service_role;
