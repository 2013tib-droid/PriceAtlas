-- =============================================================================
-- 0140 · Kontrak price_record.extra dan capture_item.extra (X-10, D-52, D-66)
-- =============================================================================
-- Kunci yang dikenal (docs/05 §2.2). Kunci lain ditolak. '{}' tetap valid.
--   shipping_fee, shop_voucher, cashback, points : number >= 0
--   listing_title (<= 500), listing_url (<= 2000, https://), member_note (<= 200),
--   note (<= 500)                                 : string
--   member_eligible                               : boolean
--   member_hint                                   : {program_id?: uuid, text: string}
-- Padanan TypeScript: packages/contracts/src/extra.ts (diuji setara).

create function app.valid_price_extra(p jsonb) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case when jsonb_typeof(p) <> 'object' then false else not exists (
       select 1 from jsonb_each(p) e
        where not case e.key
          when 'shipping_fee'    then case when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric >= 0 else false end
          when 'shop_voucher'    then case when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric >= 0 else false end
          when 'cashback'        then case when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric >= 0 else false end
          when 'points'          then case when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric >= 0 else false end
          when 'listing_title'   then jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 500
          when 'listing_url'     then jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 2000
                                      and (e.value #>> '{}') like 'https://%'
          when 'member_note'     then jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 200
          when 'note'            then jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 500
          when 'member_eligible' then jsonb_typeof(e.value) = 'boolean'
          when 'member_hint'     then
                 jsonb_typeof(e.value) = 'object'
             and jsonb_typeof(e.value -> 'text') = 'string'
             and (e.value - 'text' - 'program_id') = '{}'::jsonb
             and (not (e.value ? 'program_id')
                  or (jsonb_typeof(e.value -> 'program_id') = 'string'
                      and (e.value ->> 'program_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
          else false
        end) end
$$;
revoke all on function app.valid_price_extra(jsonb) from public, anon, authenticated;
grant execute on function app.valid_price_extra(jsonb) to authenticated, service_role;

alter table public.price_record add constraint price_record_extra_contract
  check (app.valid_price_extra(extra));
alter table public.capture_item add constraint capture_item_extra_contract
  check (app.valid_price_extra(extra));
