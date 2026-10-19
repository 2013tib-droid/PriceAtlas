-- =============================================================================
-- 0110 · Struk draft (D-49; docs/05 §2.2)
-- =============================================================================

-- Peta confidence per field: objek, kunci dari daftar yang diizinkan, nilai angka 0..1.
-- Kunci yang tidak ada berarti "tidak dinilai".
create function app.valid_confidence_map(p_map jsonb, p_keys text[]) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case when jsonb_typeof(p_map) <> 'object' then false else not exists (
       select 1 from jsonb_each(p_map) e
        where not (e.key = any (p_keys))
           or case when jsonb_typeof(e.value) = 'number'
                   then (e.value #>> '{}')::numeric not between 0 and 1
                   else true end) end
$$;
revoke all on function app.valid_confidence_map(jsonb, text[]) from public, anon, authenticated;
grant execute on function app.valid_confidence_map(jsonb, text[]) to authenticated, service_role;

alter table public.receipt alter column store_id drop not null;
alter table public.receipt add constraint receipt_store_required
  check (status = 'draft' or store_id is not null);
alter table public.receipt add column field_confidence jsonb not null default '{}'::jsonb;
alter table public.receipt add constraint receipt_field_confidence_shape
  check (app.valid_confidence_map(field_confidence,
                                  array['store', 'branch', 'date', 'time', 'total', 'subtotal']));
