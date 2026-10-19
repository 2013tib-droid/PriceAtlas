-- =============================================================================
-- 0230 · Hardening (F-06, F-07, F-12, D-68, D-71 X-08/Q-27; docs/05 §2.3)
-- =============================================================================

-- F-06: FK komposit (branch_id, store_id) memakai MATCH SIMPLE. Cabang tanpa toko
-- tidak diperiksa sama sekali, jadi dilarang.
alter table public.receipt add constraint receipt_branch_needs_store
  check (store_id is not null or branch_id is null);
alter table public.capture add constraint capture_branch_needs_store
  check (store_id is not null or branch_id is null);

-- D-71 (Q-20, Q-27): kategori error terstruktur dan jam di perangkat.
alter table public.capture add column error_code text
  check (error_code in ('blurry', 'not_a_receipt', 'unsupported', 'timeout', 'other'));
alter table public.capture add column captured_at timestamptz;

-- D-68 (Q-16): zona waktu database Asia/Jakarta untuk MVP (berlaku untuk sesi baru).
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Asia/Jakarta');
end $$;

-- F-09: sequence identitas tidak dipakai langsung oleh klien.
revoke all on all sequences in schema public from anon, authenticated;

-- F-07: ringkasan hanya menghitung record dalam mata uang default household.
create or replace function app.refresh_price_summary(p_household uuid, p_product uuid) returns void
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
  v_cur     char(3);
begin
  -- F-07: hanya mata uang default household (D-68).
  select default_currency into v_cur from public.household where id = p_household;

  select count(*) into v_count
    from public.price_record
   where household_id = p_household and product_id = p_product
     and status = 'active' and not is_bundle and currency = v_cur;

  if v_count = 0 then
    delete from public.price_summary where household_id = p_household and product_id = p_product;
    return;
  end if;

  select * into v_last from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
   order by transaction_date desc, created_at desc limit 1;

  select * into v_ball from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
   order by unit_price asc, transaction_date desc limit 1;

  select * into v_b90 from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
     and transaction_date > v_today - v_window
   order by unit_price asc, transaction_date desc limit 1;

  select avg(unit_price), count(*) into v_cur_avg, v_cur_n from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
     and transaction_date >  v_today - v_tw;
  select avg(unit_price), count(*) into v_prv_avg, v_prv_n from public.price_record
   where household_id = p_household and product_id = p_product and status = 'active' and not is_bundle and currency = v_cur
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
