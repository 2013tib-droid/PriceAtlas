-- =============================================================================
-- 0210 · D-23 ditegakkan di database (F-05, D-63; docs/05 §4.3)
-- =============================================================================
-- Price Record sumber struk diturunkan satu arah dari Receipt Line:
--   * app.derive_receipt_price(line, product): satu-satunya rumus turunan.
--   * Trigger price_record_receipt_guard: angka/header record struk harus sama
--     dengan hasil turunan (RECEIPT_DERIVED_FIELD), lalu disinkronkan.
--   * Trigger receipt_line_derive: perubahan baris (atau diskon/void yang menempel)
--     membentuk ulang record yang sudah ada; neto <= 0 → record dihapus (Q-18).
--   * app.upsert_receipt_record: dipakai konfirmasi struk dan worker.
--
-- Rumus (docs/05 §4.3):
--   unit   : quantity = L.quantity − Σ void.qty
--            normal   = coalesce(L.unit_amount, L.line_amount / L.quantity)
--            effective= round((L.line_amount + Σ diskon + Σ void) / quantity, 2)
--   weight : quantity = 1, actual_weight = L.quantity (berat) − Σ void.qty
--            normal   = L.unit_amount (per content_unit)
--            effective= round((L.line_amount + Σ diskon + Σ void) / berat, 2)
--   price_basis = promo jika ada diskon dan effective < normal (promo_price = effective).
--   Struk tidak pernah menghasilkan price_basis member (D-63); diskon bertanda
--   member dicatat di extra.member_hint.

create function app.derive_receipt_price(p_line_id uuid, p_product_id uuid)
returns table (
  household_id     uuid,
  capture_id       uuid,
  transaction_date date,
  store_id         uuid,
  branch_id        uuid,
  currency         char(3),
  quantity         numeric,
  actual_weight    numeric,
  normal_price     numeric,
  promo_price      numeric,
  effective_price  numeric,
  price_basis      text,
  member_hint      jsonb)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_line   public.receipt_line;
  v_rcpt   public.receipt;
  v_mode   text;
  v_q0     numeric;
  v_base   numeric;
  v_disc   numeric;
  v_void   numeric;
  v_voidq  numeric;
  v_hint   text;
  v_prog   uuid;
  v_q      numeric;
  v_neto   numeric;
  v_eff    numeric;
begin
  select * into v_line from public.receipt_line where id = p_line_id;
  if v_line.id is null or v_line.line_type <> 'product' then
    return;
  end if;
  select * into v_rcpt from public.receipt where id = v_line.receipt_id;
  select p.sale_mode into v_mode from public.product p where p.id = p_product_id;
  if v_mode is null then
    return;
  end if;

  v_q0   := coalesce(v_line.quantity,
                     case when v_mode = 'weight' and v_line.unit_amount > 0
                          then v_line.line_amount / v_line.unit_amount end,
                     1);
  v_base := coalesce(v_line.unit_amount, round(v_line.line_amount / v_q0, 2));

  select coalesce(sum(a.line_amount) filter (where a.line_type = 'discount'), 0),
         coalesce(sum(a.line_amount) filter (where a.line_type = 'void'), 0),
         coalesce(sum(coalesce(a.quantity, abs(a.line_amount) / nullif(v_base, 0)))
                    filter (where a.line_type = 'void'), 0),
         min(a.raw_text) filter (where a.line_type = 'discount'
                                   and app.normalize_text(a.raw_text) ~ '\mmember\M')
    into v_disc, v_void, v_voidq, v_hint
    from public.receipt_line a
   where a.applies_to_line_id = v_line.id;

  v_q    := v_q0 - v_voidq;
  v_neto := v_line.line_amount + v_disc + v_void;
  if v_q <= 0 or v_neto <= 0 then
    return;                                                    -- Q-18: tanpa record
  end if;
  v_eff := round(v_neto / v_q, 2);

  if v_hint is not null then
    select min(mp.id::text)::uuid into v_prog
      from public.member_program mp
     where mp.store_id = v_rcpt.store_id and mp.status = 'active'
    having count(*) = 1;
  end if;

  household_id     := v_line.household_id;
  capture_id       := v_rcpt.capture_id;
  transaction_date := v_rcpt.transaction_date;
  store_id         := v_rcpt.store_id;
  branch_id        := v_rcpt.branch_id;
  currency         := v_rcpt.currency;
  quantity         := case when v_mode = 'weight' then 1 else v_q end;
  actual_weight    := case when v_mode = 'weight' then v_q end;
  normal_price     := v_base;
  price_basis      := case when v_disc < 0 and v_eff < v_base then 'promo' else 'normal' end;
  promo_price      := case when price_basis = 'promo' then v_eff end;
  effective_price  := v_eff;
  member_hint      := case when v_hint is not null then
                        jsonb_strip_nulls(jsonb_build_object('text', v_hint, 'program_id', v_prog)) end;
  return next;
end $$;

-- Penjaga konsistensi D-23 (BEFORE INSERT/UPDATE pada price_record sumber struk).
-- Kolom yang boleh diubah langsung: product_id, is_bundle, status, visibility,
-- extra, match_outcome (dan kolom match_* lain). Angka/header yang dikirim klien
-- harus sama dengan hasil turunan; setelah itu nilainya disinkronkan.
create function app.price_record_receipt_guard() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  d       record;
  v_cols  text[] := array['capture_id', 'transaction_date', 'store_id', 'branch_id', 'currency',
                          'quantity', 'actual_weight', 'normal_price', 'promo_price', 'promo_min_qty',
                          'promo_valid_from', 'promo_valid_until', 'member_price', 'member_program_id',
                          'effective_price', 'price_basis'];
  v_new   jsonb;
  v_old   jsonb;
  v_want  jsonb;
  v_col   text;
begin
  if new.source_type <> 'receipt' then
    return new;
  end if;

  select * into d from app.derive_receipt_price(new.receipt_line_id, new.product_id);
  if not found then
    perform app.err('RECEIPT_DERIVED_FIELD',
                    jsonb_build_object('receipt_line_id', new.receipt_line_id, 'reason', 'no_record'));
  end if;

  v_want := jsonb_build_object(
    'capture_id', d.capture_id, 'transaction_date', d.transaction_date, 'store_id', d.store_id,
    'branch_id', d.branch_id, 'currency', d.currency, 'quantity', d.quantity,
    'actual_weight', d.actual_weight, 'normal_price', d.normal_price, 'promo_price', d.promo_price,
    'promo_min_qty', null, 'promo_valid_from', null, 'promo_valid_until', null,
    'member_price', null, 'member_program_id', null,
    'effective_price', d.effective_price, 'price_basis', d.price_basis);
  v_new := to_jsonb(new);
  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) end;

  foreach v_col in array v_cols loop
    if (tg_op = 'INSERT' or (v_new -> v_col) is distinct from (v_old -> v_col))
       and not app.jsonb_value_eq(v_new -> v_col, v_want -> v_col) then
      perform app.err('RECEIPT_DERIVED_FIELD',
                      jsonb_build_object('receipt_line_id', new.receipt_line_id, 'column', v_col,
                                         'expected', v_want -> v_col, 'got', v_new -> v_col));
    end if;
  end loop;

  new.capture_id        := d.capture_id;
  new.transaction_date  := d.transaction_date;
  new.store_id          := d.store_id;
  new.branch_id         := d.branch_id;
  new.currency          := d.currency;
  new.quantity          := d.quantity;
  new.actual_weight     := d.actual_weight;
  new.normal_price      := d.normal_price;
  new.promo_price       := d.promo_price;
  new.promo_min_qty     := null;
  new.promo_valid_from  := null;
  new.promo_valid_until := null;
  new.member_price      := null;
  new.member_program_id := null;
  new.effective_price   := d.effective_price;
  new.price_basis       := d.price_basis;
  return new;
end $$;

-- Perbandingan nilai jsonb yang setara secara numerik (2 = 2.000).
create function app.jsonb_value_eq(a jsonb, b jsonb) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when a is null or a = 'null'::jsonb then b is null or b = 'null'::jsonb
    when b is null or b = 'null'::jsonb then false
    when jsonb_typeof(a) = 'number' and jsonb_typeof(b) = 'number'
      then (a #>> '{}')::numeric = (b #>> '{}')::numeric
    else a = b end
$$;

create trigger price_record_receipt_guard
  before insert or update on public.price_record
  for each row execute function app.price_record_receipt_guard();

-- Turunan otomatis: baris produk berubah, atau diskon/void yang menempel berubah,
-- → record baris target dibentuk ulang jika sudah ada. Produk pilihan user tetap.
create function app.receipt_line_derive() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_targets uuid[];
  v_t       uuid;
  v_rec     public.price_record;
  v_type    text;
  d         record;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_targets := array[new.id, new.applies_to_line_id];
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_targets := v_targets || array[old.id, old.applies_to_line_id];
  end if;

  for v_t in select distinct x from unnest(v_targets) x where x is not null loop
    select * into v_rec from public.price_record where receipt_line_id = v_t;
    continue when v_rec.id is null;
    select line_type into v_type from public.receipt_line where id = v_t;
    continue when v_type is null;                      -- baris terhapus: record ikut cascade

    select * into d from app.derive_receipt_price(v_t, v_rec.product_id);
    if v_type <> 'product' or not found then
      delete from public.price_record where id = v_rec.id;
    elsif (v_rec.quantity, v_rec.actual_weight, v_rec.normal_price, v_rec.promo_price,
           v_rec.effective_price, v_rec.price_basis)
          is distinct from (d.quantity, d.actual_weight, d.normal_price, d.promo_price,
                            d.effective_price, d.price_basis) then
      update public.price_record
         set quantity = d.quantity, actual_weight = d.actual_weight,
             normal_price = d.normal_price, promo_price = d.promo_price,
             effective_price = d.effective_price, price_basis = d.price_basis
       where id = v_rec.id;
    end if;
  end loop;
  return null;
end $$;

create trigger receipt_line_derive
  after insert or update or delete on public.receipt_line
  for each row execute function app.receipt_line_derive();

-- Buat/perbarui record baris produk. Angka selalu dari derive_receipt_price.
-- Idempoten oleh receipt_line_id unique. Neto <= 0 → record dihapus, hasil NULL.
-- INVOKER: dipanggil RPC user (RLS berlaku) dan worker.
create function app.upsert_receipt_record(p_line_id uuid, p_product_id uuid, p_outcome text,
                                          p_is_bundle boolean default false)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  d      record;
  v_line public.receipt_line;
  v_id   uuid;
begin
  select * into v_line from public.receipt_line where id = p_line_id;
  if v_line.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('receipt_line_id', p_line_id));
  end if;

  select * into d from app.derive_receipt_price(p_line_id, p_product_id);
  if not found then
    delete from public.price_record where receipt_line_id = p_line_id;
    return null;
  end if;

  insert into public.price_record as pr (
    household_id, product_id, store_id, branch_id, source_type, receipt_line_id, capture_id,
    transaction_date, currency, quantity, actual_weight, normal_price, promo_price,
    effective_price, price_basis, is_bundle, extra, match_tier, match_confidence, match_outcome,
    created_by)
  values (
    d.household_id, p_product_id, d.store_id, d.branch_id, 'receipt', p_line_id, d.capture_id,
    d.transaction_date, d.currency, d.quantity, d.actual_weight, d.normal_price, d.promo_price,
    d.effective_price, d.price_basis, coalesce(p_is_bundle, false),
    case when d.member_hint is null then '{}'::jsonb
         else jsonb_build_object('member_hint', d.member_hint) end,
    v_line.match_tier, v_line.match_confidence, p_outcome, (select auth.uid()))
  on conflict (receipt_line_id) do update
    set product_id    = excluded.product_id,
        is_bundle     = excluded.is_bundle,
        match_outcome = excluded.match_outcome,
        extra         = pr.extra || excluded.extra
  returning pr.id into v_id;
  return v_id;
end $$;

revoke all on function app.derive_receipt_price(uuid, uuid)           from public, anon, authenticated;
revoke all on function app.price_record_receipt_guard()               from public, anon, authenticated;
revoke all on function app.jsonb_value_eq(jsonb, jsonb)               from public, anon, authenticated;
revoke all on function app.receipt_line_derive()                      from public, anon, authenticated;
revoke all on function app.upsert_receipt_record(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function app.derive_receipt_price(uuid, uuid), app.jsonb_value_eq(jsonb, jsonb),
                          app.upsert_receipt_record(uuid, uuid, text, boolean)
  to authenticated;
grant execute on all functions in schema app to service_role;
