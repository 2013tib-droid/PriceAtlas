-- =============================================================================
-- 0220 · PII dan hak akses (F-03, F-04, F-15, D-64; docs/05 §7.2, §7.4, §5.1)
-- =============================================================================

-- F-03: receipt.pii tidak terbaca authenticated (hak kolom). UPDATE hanya kolom
-- header (S-10). DELETE dicabut (hapus lewat capture). INSERT dipertahankan
-- untuk kolom selain pii — lihat Q-31 (smoke.sql menyisipkan struk sebagai user).
revoke select, insert, update, delete on public.receipt from authenticated;
grant select (id, household_id, capture_id, store_id, branch_id, transaction_date, transaction_time,
              currency, subtotal_amount, total_amount, payment_method, status,
              duplicate_of_receipt_id, confirmed_at, created_at, updated_at, field_confidence)
  on public.receipt to authenticated;
grant insert (id, household_id, capture_id, store_id, branch_id, transaction_date, transaction_time,
              currency, subtotal_amount, total_amount, payment_method, status,
              duplicate_of_receipt_id, confirmed_at, field_confidence)
  on public.receipt to authenticated;
grant update (store_id, branch_id, transaction_date, transaction_time, total_amount,
              subtotal_amount, payment_method)
  on public.receipt to authenticated;

-- F-04: processing_run hanya SELECT kolom non-mentah untuk user. Tulis oleh worker.
revoke all on public.processing_run from authenticated;
grant select (id, capture_id, household_id, status, started_at, finished_at, error_message)
  on public.processing_run to authenticated;

-- F-03: audit_log tidak menyimpan pii (snapshot tanpa kunci pii).
create or replace function app.audit_row() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_household uuid := coalesce(to_jsonb(new) ->> 'household_id', to_jsonb(old) ->> 'household_id')::uuid;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'pii' end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'pii' end;
begin
  if (select auth.uid()) is null or v_household is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and v_new - 'updated_at' = v_old - 'updated_at' then
    return null;
  end if;
  insert into public.audit_log (household_id, actor_id, entity_type, entity_id, action, before, after)
  values (v_household, (select auth.uid()), tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id')::uuid,
          lower(tg_op), v_old, v_new);
  return null;
end $$;

-- F-15: penjaga transisi capture.status (docs/05 §5.1).
--   Sistem (worker, fungsi DEFINER): transisi pipeline.
--   authenticated: insert hanya 'uploaded'; failed → uploaded dan
--   needs_confirmation → done hanya lewat RPC (penanda transaksi app.via_rpc).
create function app.capture_status_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user boolean := current_user in ('authenticated', 'anon');
  v_rpc  boolean := coalesce(current_setting('app.via_rpc', true), '') = 'on';
  v_from text := case when tg_op = 'UPDATE' then old.status end;
  v_ok   boolean;
begin
  if tg_op = 'INSERT' then
    v_ok := new.status = 'uploaded' or not v_user;
  elsif new.status = old.status then
    return new;
  elsif v_user then
    v_ok := v_rpc and (v_from, new.status) in (('failed', 'uploaded'), ('needs_confirmation', 'done'));
  else
    v_ok := (v_from, new.status) in (
      ('uploaded', 'processing'),
      ('processing', 'needs_confirmation'), ('processing', 'done'),
      ('processing', 'uploaded'), ('processing', 'failed'),
      ('failed', 'uploaded'), ('needs_confirmation', 'done'));
  end if;
  if not v_ok then
    perform app.err('INVALID_TRANSITION',
                    jsonb_build_object('capture_id', new.id, 'from', v_from, 'to', new.status));
  end if;
  return new;
end $$;
revoke all on function app.capture_status_guard() from public, anon, authenticated;

create trigger capture_status_guard
  before insert or update of status on public.capture
  for each row execute function app.capture_status_guard();

grant execute on all functions in schema app to service_role;
