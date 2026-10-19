-- =============================================================================
-- 0130 · Opt-in berbagi publik (D-51, D-67; docs/05 §2.2)
-- =============================================================================

alter table public.household add column share_prices_public boolean not null default false;

-- D-67: visibility record baru selalu mengikuti household. Nilai dari klien diabaikan.
create function app.default_visibility() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.visibility := case
    when (select h.share_prices_public from public.household h where h.id = new.household_id)
    then 'public' else 'private' end;
  return new;
end $$;
revoke all on function app.default_visibility() from public, anon, authenticated;

create trigger price_record_default_visibility
  before insert on public.price_record
  for each row execute function app.default_visibility();

-- share_prices_public hanya lewat RPC set_share_prices_public (§4.6), karena
-- mematikannya harus menarik fakta dalam transaksi yang sama. Hak kolom (§7.2).
revoke update on public.household from authenticated;
grant update (name, default_currency, timezone) on public.household to authenticated;
