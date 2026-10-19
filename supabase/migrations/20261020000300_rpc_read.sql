-- =============================================================================
-- 0300 · View dan RPC baca R1–R21 (docs/05 §3.2–§3.4)
-- =============================================================================
-- Semua RPC SECURITY INVOKER (RLS berlaku) dan STABLE, kecuali R2 (DEFINER, hanya
-- kunci whitelist). Isolasi household datang dari RLS: fungsi tidak menambahkan
-- filter household_id sendiri (desain fisik §9). Error memakai app.err (§3.1).

-- -----------------------------------------------------------------------------
-- Helper domain
-- -----------------------------------------------------------------------------

-- Household user yang login (MVP: satu household per user, docs/05 §9.3).
create function app.my_household() returns public.household
language sql stable
set search_path = ''
as $$
  select h.* from public.household h
   where h.id in (select app.my_household_ids())
   order by h.created_at, h.id
   limit 1
$$;

-- "Hari ini" di zona household (F-12, D-68).
create function app.household_today(p_household uuid) returns date
language sql stable security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select timezone from public.household where id = p_household),
                                      'Asia/Jakarta'))::date
$$;

create function app.base_unit(p_dimension text) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select case p_dimension when 'mass' then 'g' when 'volume' then 'ml'
                              when 'count' then 'pcs' when 'length' then 'm' end $$;

-- Harga per satuan dasar, rumus yang sama dengan trigger app.compute_unit_price.
-- Padanan TypeScript: packages/contracts unitPrice() (diuji setara).
create function app.unit_price_for(p_product_id uuid, p_price numeric) returns numeric
language sql stable
set search_path = ''
as $$
  select case p.sale_mode
           when 'unit'   then p_price / (p.pack_count * p.content_size * u.to_base_factor)
           when 'weight' then p_price / u.to_base_factor end
    from public.product p join public.unit u on u.code = p.content_unit
   where p.id = p_product_id
$$;

-- Harga efektif observasi (D-26, D-27, D-41, Q-19; docs/05 §5.7).
-- Kandidat yang berlaku pada tanggal d: normal; promo jika d di dalam periode
-- (batas kosong = terbuka); member jika household layak. Termurah menang; seri
-- diurutkan normal → promo → member. Tidak ada yang berlaku → effective_price NULL
-- dan reason 'no_applicable_price' (pemanggil menaikkan NO_APPLICABLE_PRICE).
-- p_member_eligible NULL → keanggotaan household SAAT INI (dipakai saat record dibuat
-- dan untuk pratinjau R16). Koreksi memakai snapshot extra.member_eligible (F-11).
create function app.observation_price(
  p_household uuid, p_date date,
  p_normal numeric, p_promo numeric, p_promo_from date, p_promo_until date,
  p_member numeric, p_member_program uuid, p_member_eligible boolean default null)
returns table (effective_price numeric, price_basis text, member_eligible boolean, reason text)
language plpgsql stable
set search_path = ''
as $$
declare
  v_eligible boolean;
begin
  v_eligible := case
    when p_member is null or p_member_program is null then null
    when p_member_eligible is not null then p_member_eligible
    else exists (select 1 from public.household_program_membership m
                  where m.household_id = p_household and m.member_program_id = p_member_program) end;

  select c.price, c.basis into effective_price, price_basis
    from (values (p_normal, 'normal', 1),
                 (case when p_promo is not null
                        and (p_promo_from is null or p_date >= p_promo_from)
                        and (p_promo_until is null or p_date <= p_promo_until) then p_promo end, 'promo', 2),
                 (case when v_eligible then p_member end, 'member', 3)) c(price, basis, ord)
   where c.price is not null
   order by c.price, c.ord
   limit 1;

  member_eligible := v_eligible;
  reason := case when effective_price is null then 'no_applicable_price' end;
  return next;
end $$;

-- Bagian "product" dari ProductCard.
create function app.product_lite(p_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'variant', p.variant, 'sale_mode', p.sale_mode,
    'pack_count', p.pack_count, 'content_size', p.content_size, 'content_unit', p.content_unit,
    'dimension', u.dimension, 'base_unit', app.base_unit(u.dimension),
    'is_private', p.household_id is not null, 'status', p.status,
    'product_group_id', p.product_group_id, 'merged_into_id', p.merged_into_id,
    'brand_name', b.name, 'category_name', c.name)
    from public.product p
    join public.unit u on u.code = p.content_unit
    left join public.brand b on b.id = p.brand_id
    left join public.category c on c.id = p.category_id
   where p.id = p_id
$$;

create function app.store_json(p_store_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'channel', s.channel, 'is_private', s.household_id is not null)
    from public.store s where s.id = p_store_id
$$;

create function app.branch_json(p_branch_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'status', b.status, 'kind', b.kind,
                            'is_private', b.household_id is not null)
    from public.branch b where b.id = p_branch_id
$$;

-- PricePoint (docs/05 §3.2).
create function app.price_point(p_record_id uuid, p_effective numeric, p_unit numeric, p_basis text,
                                p_date date, p_store_id uuid, p_branch_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'record_id', p_record_id, 'effective_price', p_effective, 'unit_price', p_unit,
    'price_basis', p_basis,
    'member_program_name', (select mp.name from public.price_record r
                              join public.member_program mp on mp.id = r.member_program_id
                             where r.id = p_record_id and r.price_basis = 'member'),
    'date', p_date, 'store', app.store_json(p_store_id), 'branch', app.branch_json(p_branch_id))
$$;

-- ProductCard (docs/05 §3.2): product, group, summary, hints.
create function app.product_card(p_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'product', app.product_lite(p.id),
    'group', case when g.id is null then null else jsonb_build_object(
      'id', g.id, 'name', g.name,
      'best_by_dimension', (
        select jsonb_build_object('unit_price', s2.best_90d_unit_price, 'product_id', s2.product_id)
          from public.product p2
          join public.unit u2 on u2.code = p2.content_unit
          join public.price_summary s2 on s2.product_id = p2.id
         where p2.product_group_id = g.id and p2.status = 'active' and u2.dimension = u.dimension
           and s2.best_90d_unit_price is not null
         order by s2.best_90d_unit_price, p2.id
         limit 1)) end,
    'summary', case when s.product_id is null then null else jsonb_build_object(
      'record_count', s.record_count,
      'last_transaction_date', s.last_transaction_date,
      'last_effective_price', s.last_effective_price,
      'last_unit_price', s.last_unit_price,
      'best_90d', case when s.best_90d_record_id is null then null else
        app.price_point(s.best_90d_record_id, s.best_90d_effective_price, s.best_90d_unit_price,
                        s.best_90d_price_basis, s.best_90d_date, s.best_90d_store_id, s.best_90d_branch_id) end,
      'best_all', app.price_point(s.best_all_record_id, s.best_all_effective_price, s.best_all_unit_price,
                                  s.best_all_price_basis, s.best_all_date, s.best_all_store_id, s.best_all_branch_id),
      'trend_direction', s.trend_direction,
      'trend_pct', s.trend_pct,
      'refreshed_at', s.refreshed_at) end,
    'hints', jsonb_build_object(
      'member_not_counted', (                                        -- X-07
        select jsonb_build_object('member_price', r.member_price, 'program_name', mp.name,
                                  'store_name', st.name, 'record_id', r.id, 'date', r.transaction_date)
          from public.price_record r
          join public.member_program mp on mp.id = r.member_program_id
          join public.store st on st.id = r.store_id
         where r.product_id = p.id and r.status = 'active'
           and r.member_price is not null and r.price_basis <> 'member'
         order by r.transaction_date desc, r.created_at desc
         limit 1),
      'bundle_only_count', (select count(*) from public.price_record r
                             where r.product_id = p.id and r.status = 'active' and r.is_bundle)))
    from public.product p
    join public.unit u on u.code = p.content_unit
    left join public.product_group g on g.id = p.product_group_id
    left join public.price_summary s on s.product_id = p.id
   where p.id = p_id
$$;

-- Produk tujuan jika sudah di-merge (rantai sudah dipadatkan oleh merge_product).
create function app.resolve_product(p_id uuid) returns uuid
language sql stable
set search_path = ''
as $$ select coalesce(p.merged_into_id, p.id) from public.product p where p.id = p_id $$;

-- -----------------------------------------------------------------------------
-- View price_record_view (security_invoker)
-- -----------------------------------------------------------------------------
create view public.price_record_view with (security_invoker = true) as
select pr.*,
       s.name    as store_name,
       s.channel as store_channel,
       b.name    as branch_name,
       b.status  as branch_status,
       mp.name   as member_program_name,
       case when pr.normal_price is null then null
            when p.sale_mode = 'unit'   then pr.normal_price / (p.pack_count * p.content_size * u.to_base_factor)
            when p.sale_mode = 'weight' then pr.normal_price / u.to_base_factor end as normal_unit_price,
       (pr.member_price is not null and pr.price_basis <> 'member') as member_not_counted,
       rl.receipt_id
  from public.price_record pr
  left join public.product p          on p.id = pr.product_id
  left join public.unit u             on u.code = p.content_unit
  left join public.store s            on s.id = pr.store_id
  left join public.branch b           on b.id = pr.branch_id
  left join public.member_program mp  on mp.id = pr.member_program_id
  left join public.receipt_line rl    on rl.id = pr.receipt_line_id;

-- -----------------------------------------------------------------------------
-- R1 get_my_context · R2 get_client_config
-- -----------------------------------------------------------------------------
create function public.get_my_context() returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'display_name', (select pr.display_name from public.profile pr where pr.user_id = (select auth.uid())),
    'household', jsonb_build_object('id', h.id, 'name', h.name, 'default_currency', h.default_currency,
                                    'timezone', h.timezone, 'share_prices_public', h.share_prices_public),
    'role', (select m.role from public.household_member m
              where m.household_id = h.id and m.user_id = (select auth.uid())),
    'program_ids', coalesce((select jsonb_agg(m.member_program_id order by m.member_program_id)
                               from public.household_program_membership m where m.household_id = h.id),
                            '[]'::jsonb))
    from app.my_household() h
   where h.id is not null
$$;

create function public.get_client_config() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb)
    from app.config c
   where c.key in ('best_price_window_days', 'trend_window_days', 'trend_min_records_per_window',
                   'trend_flat_threshold_pct', 'auto_save_min_confidence', 'near_best_threshold_pct',
                   'session_extend_hours', 'image_retention_months')
$$;

-- -----------------------------------------------------------------------------
-- R3 search_products (D-53, F-13)
-- -----------------------------------------------------------------------------
create function public.search_products(p_query text, p_limit integer default 30) returns setof jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_q text := app.normalize_text(p_query);
begin
  if v_q is null or length(v_q) < 2 then
    raise exception using errcode = '22023', message = 'QUERY_TOO_SHORT',
                          hint = 'Ketik minimal 2 huruf.';
  end if;

  return query
  with brand_hit as (
    select b.id from public.brand b
     where b.status = 'active' and v_q operator(extensions.<%) b.normalized_name),
  hit as (
    select p.id,
           extensions.word_similarity(v_q, p.search_text || ' ' || coalesce(b.normalized_name, '')) as score
      from public.product p
      left join public.brand b on b.id = p.brand_id
     where p.status = 'active'                                   -- merged/archived disaring
       and (v_q operator(extensions.<%) p.search_text
            or p.brand_id in (select id from brand_hit))),
  card as (
    select app.product_card(h.id) as c, h.score from hit h)
  select card.c || jsonb_build_object('match_score', round(card.score::numeric, 3))
    from card
   order by (card.c -> 'summary') <> 'null'::jsonb desc,         -- yang punya data dulu (D-53)
            card.score desc, card.c #>> '{product,name}', card.c #>> '{product,id}'
   limit least(greatest(coalesce(p_limit, 30), 1), 50);
end $$;

-- -----------------------------------------------------------------------------
-- R4 get_product_cards · R5 get_offline_cache
-- -----------------------------------------------------------------------------
create function public.get_product_cards(p_ids uuid[]) returns setof jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  if cardinality(p_ids) > 50 then
    raise exception using errcode = '22023', message = 'TOO_MANY_IDS', hint = 'Maksimal 50 produk.';
  end if;
  return query
  select app.product_card(r.id)
    from (select app.resolve_product(x.id) as id, min(x.ord) as ord
            from unnest(p_ids) with ordinality x(id, ord)
           group by 1) r
   where r.id is not null
   order by r.ord;
end $$;

create function public.get_offline_cache(p_viewed_ids uuid[] default '{}', p_top integer default 50)
returns setof jsonb
language sql stable
set search_path = ''
as $$
  with viewed as (
    select app.resolve_product(x.id) as id, 0 as grp, x.ord::bigint as ord
      from unnest(coalesce(p_viewed_ids, '{}')) with ordinality x(id, ord)
     limit 200),
  top as (
    select s.product_id as id, 1 as grp, row_number() over (order by s.record_count desc, s.product_id) as ord
      from public.price_summary s
     order by s.record_count desc, s.product_id
     limit least(greatest(coalesce(p_top, 50), 0), 200)),
  allp as (
    select distinct on (id) id, grp, ord from (select * from viewed union all select * from top) u
     where id is not null
     order by id, grp, ord)
  select app.product_card(a.id) from allp a
    join public.product p on p.id = a.id and p.status <> 'merged'
   order by a.grp, a.ord
$$;

-- -----------------------------------------------------------------------------
-- R6 find_product_by_barcode (D-58, F-01)
-- -----------------------------------------------------------------------------
create function public.find_product_by_barcode(p_code text, p_store_id uuid default null) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('product_id', coalesce(p.merged_into_id, p.id),
                            'via_merge', p.merged_into_id is not null)
    from public.barcode_assignment ba
    join public.product p on p.id = ba.product_id
   where ba.code = btrim(p_code)
     and ba.valid_from <= app.household_today((app.my_household()).id)
     and (ba.valid_until is null or ba.valid_until > app.household_today((app.my_household()).id))
     and (ba.code_type = 'gtin' or ba.store_id = p_store_id)
     and p.status <> 'archived'
   order by (ba.household_id is null), (ba.code_type = 'gtin'), ba.valid_from desc
   limit 1
$$;

-- -----------------------------------------------------------------------------
-- R10 price_trend (D-54): dipakai R7 dan tool AI
-- -----------------------------------------------------------------------------
create function public.price_trend(p_product_id uuid, p_normal_only boolean default false) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_h     public.household := app.my_household();
  v_today date := app.household_today(v_h.id);
  v_w     integer := app.config_numeric('trend_window_days')::integer;
  v_min   integer := app.config_numeric('trend_min_records_per_window')::integer;
  v_flat  numeric := app.config_numeric('trend_flat_threshold_pct');
  v_cur_avg numeric; v_cur_n integer; v_prev_avg numeric; v_prev_n integer;
  v_count integer; v_last date;
  v_pct   numeric; v_dir text;
begin
  if not exists (select 1 from public.product where id = p_product_id) then
    perform app.err('NOT_FOUND', jsonb_build_object('product_id', p_product_id));
  end if;

  select avg(u) filter (where transaction_date >  v_today - v_w),
         count(*) filter (where transaction_date >  v_today - v_w),
         avg(u) filter (where transaction_date <= v_today - v_w and transaction_date > v_today - 2 * v_w),
         count(*) filter (where transaction_date <= v_today - v_w and transaction_date > v_today - 2 * v_w),
         count(*), max(transaction_date)
    into v_cur_avg, v_cur_n, v_prev_avg, v_prev_n, v_count, v_last
    from (select transaction_date,
                 case when p_normal_only then normal_unit_price else unit_price end as u
            from public.price_record_view
           where product_id = p_product_id and status = 'active' and not is_bundle
             and currency = v_h.default_currency) r
   where u is not null;

  if v_cur_n >= v_min and v_prev_n >= v_min and v_prev_avg > 0 then
    v_pct := round((v_cur_avg - v_prev_avg) / v_prev_avg * 100, 2);
    v_dir := case when v_pct >= v_flat then 'up' when v_pct <= -v_flat then 'down' else 'flat' end;
  end if;

  return jsonb_build_object(
    'cur_avg', round(v_cur_avg, 6), 'cur_n', v_cur_n, 'prev_avg', round(v_prev_avg, 6), 'prev_n', v_prev_n,
    'pct', v_pct, 'direction', v_dir, 'label', 'vs 30 hari sebelumnya',
    'min_records_per_window', v_min, 'normal_only', p_normal_only,
    'record_count', v_count, 'last_date', v_last);
end $$;

-- -----------------------------------------------------------------------------
-- R7 get_product_detail
-- -----------------------------------------------------------------------------
create function public.get_product_detail(p_product_id uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_p     public.product;
  v_id    uuid;
  v_trend jsonb;
begin
  select * into v_p from public.product where id = p_product_id;
  if v_p.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('product_id', p_product_id));
  end if;
  v_id := coalesce(v_p.merged_into_id, v_p.id);
  v_trend := public.price_trend(v_id, false);

  return jsonb_build_object(
    'redirect_to', case when v_id <> p_product_id then v_id end,
    'card', app.product_card(v_id),
    'last_record', (
      select jsonb_build_object('record_id', r.id, 'store', app.store_json(r.store_id),
                                'branch', app.branch_json(r.branch_id), 'date', r.transaction_date,
                                'effective_price', r.effective_price, 'price_basis', r.price_basis)
        from public.price_record r
       where r.product_id = v_id and r.status = 'active'
       order by r.transaction_date desc, r.created_at desc
       limit 1),
    'trend_windows', jsonb_build_object('cur_n', v_trend -> 'cur_n', 'prev_n', v_trend -> 'prev_n',
                                        'cur_avg', v_trend -> 'cur_avg', 'prev_avg', v_trend -> 'prev_avg'),
    'group_sizes_count', (select count(*) from public.product g
                           where g.product_group_id = (select product_group_id from public.product where id = v_id)
                             and g.status = 'active'));
end $$;

-- -----------------------------------------------------------------------------
-- R8 price_history · R9 price_chart
-- -----------------------------------------------------------------------------
create function public.price_history(
  p_product_id uuid, p_include_void boolean default false, p_store_id uuid default null,
  p_limit integer default 50, p_before_date date default null, p_before_id uuid default null)
returns setof public.price_record_view
language sql stable
set search_path = ''
as $$
  select v.* from public.price_record_view v
   where v.product_id = p_product_id
     and (p_include_void or v.status = 'active')
     and (p_store_id is null or v.store_id = p_store_id)
     and (p_before_date is null
          or (v.transaction_date, v.id) < (p_before_date, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by v.transaction_date desc, v.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create function public.price_chart(p_product_id uuid, p_normal_only boolean default false)
returns table (date date, unit_price numeric, price_basis text, record_id uuid)
language sql stable
set search_path = ''
as $$
  select v.transaction_date,
         case when p_normal_only then v.normal_unit_price else v.unit_price end,
         case when p_normal_only then 'normal' else v.price_basis end,
         v.id
    from public.price_record_view v
   where v.product_id = p_product_id and v.status = 'active' and not v.is_bundle
     and v.currency = (app.my_household()).default_currency
     and (not p_normal_only or v.normal_unit_price is not null)
   order by v.transaction_date, v.created_at
$$;

-- -----------------------------------------------------------------------------
-- R11 compare_sizes: peringkat per dimensi dan mata uang, tanpa data di bawah
-- -----------------------------------------------------------------------------
create function public.compare_sizes(p_group_id uuid, p_window text default '90d') returns setof jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_cur char(3) := (app.my_household()).default_currency;
begin
  if p_window not in ('90d', 'all') then
    raise exception using errcode = '22023', message = 'INVALID_WINDOW', hint = 'Jendela 90d atau all.';
  end if;
  if not exists (select 1 from public.product_group where id = p_group_id) then
    perform app.err('NOT_FOUND', jsonb_build_object('product_group_id', p_group_id));
  end if;

  return query
  with base as (
    select p.id, p.pack_count, u.dimension,
           case when p_window = '90d' then s.best_90d_unit_price      else s.best_all_unit_price end      as unit_price,
           case when p_window = '90d' then s.best_90d_effective_price else s.best_all_effective_price end as effective_price,
           case when p_window = '90d' then s.best_90d_price_basis     else s.best_all_price_basis end     as price_basis,
           case when p_window = '90d' then s.best_90d_store_id        else s.best_all_store_id end        as store_id,
           case when p_window = '90d' then s.best_90d_branch_id       else s.best_all_branch_id end       as branch_id,
           case when p_window = '90d' then s.best_90d_date            else s.best_all_date end            as date,
           s.last_transaction_date,
           exists (select 1 from public.price_record r
                    where r.product_id = p.id and r.status = 'active' and r.currency <> v_cur) as other_currency
      from public.product p
      join public.unit u on u.code = p.content_unit
      left join public.price_summary s on s.product_id = p.id
     where p.product_group_id = p_group_id and p.status = 'active'),
  ranked as (
    select b.*,
           case when b.unit_price is not null
                then rank() over (partition by b.dimension, (b.unit_price is null) order by b.unit_price) end as rnk,
           min(b.unit_price) over (partition by b.dimension) as best
      from base b)
  select jsonb_build_object(
           'product', app.product_lite(r.id), 'dimension', r.dimension, 'currency', v_cur,
           'unit_price', r.unit_price, 'effective_price', r.effective_price, 'price_basis', r.price_basis,
           'per_pack_price', case when r.pack_count > 1 then round(r.effective_price / r.pack_count, 2) end,
           'store', app.store_json(r.store_id), 'branch', app.branch_json(r.branch_id), 'date', r.date,
           'last_transaction_date', r.last_transaction_date, 'rank', r.rnk,
           'pct_vs_best', case when r.unit_price is not null and r.best > 0
                               then round((r.unit_price - r.best) / r.best * 100, 1) end,
           'has_data', r.unit_price is not null,
           'other_currency', r.unit_price is null and r.other_currency)
    from ranked r
   order by r.dimension, (r.unit_price is null), r.unit_price, r.id;
end $$;

-- -----------------------------------------------------------------------------
-- R12 where_cheaper: per dimensi + mata uang, dikelompokkan per id (F-08)
-- -----------------------------------------------------------------------------
create function public.where_cheaper(p_product_id uuid default null, p_group_id uuid default null,
                                     p_window_days integer default 90) returns setof jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_today date := app.household_today((app.my_household()).id);
begin
  if (p_product_id is null) = (p_group_id is null) then
    raise exception using errcode = '22023', message = 'ONE_OF_PRODUCT_OR_GROUP',
                          hint = 'Isi salah satu: produk atau group.';
  end if;
  if p_product_id is not null and not exists (select 1 from public.product where id = p_product_id)
     or p_group_id is not null and not exists (select 1 from public.product_group where id = p_group_id) then
    perform app.err('NOT_FOUND', jsonb_build_object('product_id', p_product_id, 'product_group_id', p_group_id));
  end if;

  return query
  with agg as (
    select u.dimension, pr.currency, pr.store_id, pr.branch_id,
           min(pr.unit_price) as min_unit_price, avg(pr.unit_price) as avg_unit_price,
           count(*) as n, max(pr.transaction_date) as last_date
      from public.price_record pr
      join public.product p on p.id = pr.product_id
      join public.unit u    on u.code = p.content_unit
     where (p_product_id is null or pr.product_id = p_product_id)
       and (p_group_id   is null or p.product_group_id = p_group_id)
       and pr.status = 'active' and not pr.is_bundle
       and (p_window_days is null or pr.transaction_date > v_today - p_window_days)
     group by u.dimension, pr.currency, pr.store_id, pr.branch_id)
  select jsonb_build_object(
           'dimension', a.dimension, 'currency', a.currency,
           'store', app.store_json(a.store_id), 'branch', app.branch_json(a.branch_id),
           'successor_branch', case when b.status = 'closed' then app.branch_json(b.successor_branch_id) end,
           'min_unit_price', a.min_unit_price, 'avg_unit_price', round(a.avg_unit_price, 6),
           'n', a.n, 'last_date', a.last_date, 'is_online', s.channel = 'online')
    from agg a
    join public.store s on s.id = a.store_id
    left join public.branch b on b.id = a.branch_id
   order by a.dimension, a.currency, a.avg_unit_price, a.store_id, a.branch_id;
end $$;

-- -----------------------------------------------------------------------------
-- R13 list_captures · R14 get_capture
-- -----------------------------------------------------------------------------
create function public.list_captures(p_limit integer default 30, p_before timestamptz default null,
                                     p_kind text default null) returns setof jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'status', c.status,
           'store_name', (select s.name from public.store s where s.id = coalesce(r.store_id, c.store_id, ci.store_id)),
           'branch_name', (select b.name from public.branch b where b.id = coalesce(r.branch_id, c.branch_id, ci.branch_id)),
           'date', coalesce(r.transaction_date, ci.transaction_date,
                            (c.uploaded_at at time zone (select h.timezone from public.household h where h.id = c.household_id))::date),
           'date_is_upload', r.id is null,
           'needs_check_count', case
              when c.status <> 'needs_confirmation' then 0
              when r.id is not null then (select count(*) from public.receipt_line l
                                           where l.receipt_id = r.id and l.line_type = 'product'
                                             and not exists (select 1 from public.price_record pr where pr.receipt_line_id = l.id))
              else (select count(*) from public.capture_item i where i.capture_id = c.id and i.status = 'pending') end,
           'saved_count', (select count(*) from public.price_record pr where pr.capture_id = c.id and pr.status = 'active'),
           'error_message', c.error_message, 'error_code', c.error_code,
           'attempts', (select count(*) from public.processing_run pr where pr.capture_id = c.id),
           'uploaded_at', c.uploaded_at, 'receipt_id', r.id)
    from public.capture c
    left join public.receipt r on r.capture_id = c.id
    left join lateral (select i.store_id, i.branch_id, i.transaction_date from public.capture_item i
                        where i.capture_id = c.id order by i.position limit 1) ci on true
   where (p_before is null or c.uploaded_at < p_before)
     and (p_kind is null or c.kind = p_kind)
   order by c.uploaded_at desc, c.id desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

create function public.get_capture(p_capture_id uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_c public.capture;
begin
  select * into v_c from public.capture where id = p_capture_id;
  if v_c.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('capture_id', p_capture_id));
  end if;
  return jsonb_build_object(
    'capture', to_jsonb(v_c),
    'images', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'storage_path', i.storage_path,
                                                            'purged_at', i.purged_at, 'sha256', i.sha256)
                                         order by i.position)
                          from public.capture_image i where i.capture_id = v_c.id), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'started_at', r.started_at,
                                                          'finished_at', r.finished_at, 'error_message', r.error_message)
                                       order by r.started_at)
                        from public.processing_run r where r.capture_id = v_c.id), '[]'::jsonb),
    'receipt_id', (select r.id from public.receipt r where r.capture_id = v_c.id),
    'saved_records', coalesce((select jsonb_agg(to_jsonb(v) order by v.transaction_date desc, v.id)
                                 from public.price_record_view v where v.capture_id = v_c.id), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
-- R15 get_receipt (S-10): header tanpa pii
-- -----------------------------------------------------------------------------
create function app.receipt_duplicate(p_receipt_id uuid) returns uuid
language sql stable
set search_path = ''
as $$
  -- D-20: duplikat jika ditandai worker, atau sidik jari toko + tanggal + total sama.
  select coalesce(
    (select r.duplicate_of_receipt_id from public.receipt r where r.id = p_receipt_id),
    (select o.id from public.receipt r
       join public.receipt o on o.household_id = r.household_id and o.id <> r.id
                            and o.store_id = r.store_id and o.transaction_date = r.transaction_date
                            and o.total_amount = r.total_amount and o.status <> 'discarded'
      where r.id = p_receipt_id and r.store_id is not null
      order by o.created_at limit 1))
$$;

create function public.get_receipt(p_receipt_id uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_r     record;
  v_dup   uuid;
  v_hint  jsonb;
  v_sum   numeric;
begin
  select r.id, r.household_id, r.capture_id, r.store_id, r.branch_id, r.transaction_date, r.transaction_time,
         r.currency, r.subtotal_amount, r.total_amount, r.payment_method, r.status, r.duplicate_of_receipt_id,
         r.confirmed_at, r.created_at, r.updated_at, r.field_confidence
    into v_r
    from public.receipt r where r.id = p_receipt_id;
  if v_r.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('receipt_id', p_receipt_id));
  end if;

  v_dup := case when v_r.status = 'draft' then app.receipt_duplicate(v_r.id) else v_r.duplicate_of_receipt_id end;
  select coalesce(sum(l.line_amount), 0) into v_sum from public.receipt_line l where l.receipt_id = v_r.id;
  select jsonb_strip_nulls(jsonb_build_object(
           'text', l.raw_text,
           'program_id', (select min(mp.id::text)::uuid from public.member_program mp
                           where mp.store_id = v_r.store_id and mp.status = 'active' having count(*) = 1)))
    into v_hint
    from public.receipt_line l
   where l.receipt_id = v_r.id and l.line_type = 'discount' and app.normalize_text(l.raw_text) ~ '\mmember\M'
   order by l.line_no limit 1;

  return jsonb_build_object(
    'header', jsonb_build_object(
      'id', v_r.id, 'status', v_r.status, 'capture_id', v_r.capture_id,
      'store', app.store_json(v_r.store_id), 'branch', app.branch_json(v_r.branch_id),
      'transaction_date', v_r.transaction_date, 'transaction_time', v_r.transaction_time,
      'currency', v_r.currency, 'subtotal_amount', v_r.subtotal_amount, 'total_amount', v_r.total_amount,
      'payment_method', v_r.payment_method, 'confirmed_at', v_r.confirmed_at, 'updated_at', v_r.updated_at),
    'field_confidence', v_r.field_confidence,
    'uploaded_at', (select c.uploaded_at from public.capture c where c.id = v_r.capture_id),
    'images', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'storage_path', i.storage_path,
                                                            'purged_at', i.purged_at) order by i.position)
                          from public.capture_image i where i.capture_id = v_r.capture_id), '[]'::jsonb),
    'totals', jsonb_build_object('lines_sum', v_sum, 'total_amount', v_r.total_amount,
                                 'diff', v_r.total_amount - v_sum),
    'duplicate', (select jsonb_build_object('receipt_id', d.id, 'store', app.store_json(d.store_id),
                                            'date', d.transaction_date, 'total', d.total_amount)
                    from public.receipt d where d.id = v_dup),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'line_no', l.line_no, 'line_type', l.line_type, 'raw_text', l.raw_text,
               'quantity', l.quantity, 'unit_amount', l.unit_amount, 'line_amount', l.line_amount,
               'updated_at', l.updated_at, 'match_tier', l.match_tier, 'match_confidence', l.match_confidence,
               'attached', coalesce((select jsonb_agg(jsonb_build_object(
                                        'id', a.id, 'line_no', a.line_no, 'line_type', a.line_type,
                                        'raw_text', a.raw_text, 'quantity', a.quantity,
                                        'line_amount', a.line_amount, 'updated_at', a.updated_at)
                                        order by a.line_no)
                                       from public.receipt_line a where a.applies_to_line_id = l.id), '[]'::jsonb),
               'suggestion', app.product_lite(l.suggested_product_id),
               'record', (select to_jsonb(v) from public.price_record_view v where v.receipt_line_id = l.id),
               'needs_check', l.line_type = 'product' and v_r.status = 'draft'
                              and not exists (select 1 from public.price_record pr where pr.receipt_line_id = l.id))
               order by l.line_no)
        from public.receipt_line l
       where l.receipt_id = v_r.id and l.line_type not in ('discount', 'void')), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'description', a.description,
                                                                 'amount', a.amount, 'points', a.points) order by a.created_at)
                               from public.receipt_adjustment a where a.receipt_id = v_r.id), '[]'::jsonb),
    'member_hint', v_hint,
    'membership_known', exists (select 1 from public.household_program_membership m
                                  join public.member_program mp on mp.id = m.member_program_id
                                 where m.household_id = v_r.household_id and mp.store_id = v_r.store_id));
end $$;

-- -----------------------------------------------------------------------------
-- R16 get_capture_items (S-11): computed dihitung live untuk item pending (D-26)
-- -----------------------------------------------------------------------------
create function public.get_capture_items(p_capture_id uuid) returns setof jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.capture where id = p_capture_id) then
    perform app.err('NOT_FOUND', jsonb_build_object('capture_id', p_capture_id));
  end if;

  return query
  select to_jsonb(i) || jsonb_build_object(
           'suggestion', app.product_lite(i.suggested_product_id),
           'candidates', coalesce((select jsonb_agg(app.product_lite(x.id) order by x.ord)
                                     from unnest(i.candidate_product_ids) with ordinality x(id, ord)
                                    where exists (select 1 from public.product p where p.id = x.id)), '[]'::jsonb),
           'computed', case
              when i.status = 'pending' then (
                select jsonb_build_object('effective_price', op.effective_price, 'price_basis', op.price_basis,
                                          'member_eligible', op.member_eligible, 'reason', op.reason,
                                          'unit_price', app.unit_price_for(i.suggested_product_id, op.effective_price))
                  from app.observation_price(i.household_id, i.transaction_date, i.normal_price, i.promo_price,
                                             i.promo_valid_from, i.promo_valid_until, i.member_price,
                                             i.member_program_id) op)
              when i.status = 'accepted' then (
                select jsonb_build_object('effective_price', pr.effective_price, 'price_basis', pr.price_basis,
                                          'member_eligible', (pr.extra -> 'member_eligible'), 'reason', null,
                                          'unit_price', pr.unit_price)
                  from public.price_record pr where pr.id = i.price_record_id) end,
           'needs_check', i.status = 'pending')
    from public.capture_item i
   where i.capture_id = p_capture_id
   order by i.position;
end $$;

-- -----------------------------------------------------------------------------
-- R17 recent_locations · R18 get_active_session
-- -----------------------------------------------------------------------------
create function public.recent_locations(p_limit integer default 10) returns setof jsonb
language sql stable
set search_path = ''
as $$
  with used as (
    select store_id, branch_id, created_at as ts from public.price_record
    union all
    select store_id, branch_id, uploaded_at from public.capture where store_id is not null
    union all
    select b.store_id, s.branch_id, s.started_at from public.shopping_session s
      join public.branch b on b.id = s.branch_id),
  agg as (
    select store_id, branch_id, max(ts) as last_used from used group by store_id, branch_id)
  select jsonb_build_object('store', app.store_json(a.store_id), 'branch', app.branch_json(a.branch_id),
                            'last_used', a.last_used)
    from agg a
   order by a.last_used desc, a.store_id, a.branch_id
   limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

create function public.get_active_session() returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'started_at', s.started_at, 'expires_at', s.expires_at),
    'store', app.store_json(b.store_id),
    'branch', app.branch_json(b.id),
    'labels', coalesce((
      select jsonb_agg(l.j order by l.uploaded_at desc, l.position)
        from (
          select c.uploaded_at, coalesce(i.position, 0) as position,
                 jsonb_build_object(
                   'capture_id', c.id, 'status', c.status, 'item_id', i.id,
                   'product', app.product_lite(coalesce(pr.product_id, i.suggested_product_id)),
                   'effective_price', coalesce(pr.effective_price, op.effective_price),
                   'price_basis', coalesce(pr.price_basis, op.price_basis),
                   'vs_best_pct', round((u.unit_price - sm.best_90d_unit_price) / nullif(sm.best_90d_unit_price, 0) * 100, 1),
                   'vs_last_pct', round((u.unit_price - sm.last_unit_price) / nullif(sm.last_unit_price, 0) * 100, 1)) as j
            from public.capture c
            left join public.capture_item i on i.capture_id = c.id and i.status <> 'rejected'
            left join public.price_record pr on pr.id = i.price_record_id
            left join lateral (select * from app.observation_price(i.household_id, i.transaction_date, i.normal_price,
                                 i.promo_price, i.promo_valid_from, i.promo_valid_until, i.member_price,
                                 i.member_program_id)) op on i.id is not null and pr.id is null
            left join lateral (select coalesce(pr.unit_price,
                                               app.unit_price_for(i.suggested_product_id, op.effective_price)) as unit_price) u on true
            left join public.price_summary sm on sm.product_id = coalesce(pr.product_id, i.suggested_product_id)
           where c.shopping_session_id = s.id) l), '[]'::jsonb))
    from public.shopping_session s
    join public.branch b on b.id = s.branch_id
   where s.ended_at is null and s.expires_at > now()
   order by s.started_at desc
   limit 1
$$;

-- -----------------------------------------------------------------------------
-- R19 merge_product_preview (S-17, U-16)
-- -----------------------------------------------------------------------------
create function public.merge_product_preview(p_from uuid, p_into uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_from   public.product;
  v_into   public.product;
  v_fd     text;
  v_id     text;
  v_reason text;
begin
  select * into v_from from public.product where id = p_from;
  select * into v_into from public.product where id = p_into;
  if v_from.id is null or v_into.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('from', p_from, 'into', p_into));
  end if;
  select dimension into v_fd from public.unit where code = v_from.content_unit;
  select dimension into v_id from public.unit where code = v_into.content_unit;

  v_reason := case
    when v_from.id = v_into.id then 'same_product'
    when v_from.status = 'merged' and v_from.merged_into_id = v_into.id then 'already_merged'
    when v_from.household_id is null then 'source_global'                       -- D-30, MERGE_FORBIDDEN
    when v_from.status <> 'active' then 'source_not_active'
    when v_into.status <> 'active' then 'target_not_active'
    when v_into.household_id is not null and v_into.household_id <> v_from.household_id then 'target_other_household'
  end;

  return jsonb_build_object(
    'can_merge', v_reason is null,
    'reason', v_reason,
    'counts', jsonb_build_object(
      'price_records', (select count(*) from public.price_record where product_id = v_from.id),
      'aliases',       (select count(*) from public.product_alias where product_id = v_from.id and status = 'active'),
      'barcodes',      (select count(*) from public.barcode_assignment where product_id = v_from.id),
      'barcodes_kept', case when v_from.household_id is distinct from v_into.household_id   -- F-01
                            then (select count(*) from public.barcode_assignment where product_id = v_from.id)
                            else 0 end),
    'size_mismatch', (v_from.sale_mode, v_from.pack_count, v_from.content_size, v_from.content_unit)
                     is distinct from (v_into.sale_mode, v_into.pack_count, v_into.content_size, v_into.content_unit),
    'dimension_mismatch', v_fd is distinct from v_id,
    'from', app.product_lite(v_from.id),
    'into', app.product_lite(v_into.id));
end $$;

-- -----------------------------------------------------------------------------
-- R20 price_record_detail (S-16)
-- -----------------------------------------------------------------------------
create function public.price_record_detail(p_id uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_rec jsonb;
  v_pr  public.price_record;
  v_line public.receipt_line;
  v_img jsonb;
begin
  select * into v_pr from public.price_record where id = p_id;
  if v_pr.id is null then
    perform app.err('NOT_FOUND', jsonb_build_object('price_record_id', p_id));
  end if;
  select to_jsonb(v) into v_rec from public.price_record_view v where v.id = p_id;
  select * into v_line from public.receipt_line where id = v_pr.receipt_line_id;

  select jsonb_build_object('storage_path', ci.storage_path, 'position', ci.position, 'purged_at', ci.purged_at)
    into v_img
    from public.capture_image ci
   where ci.capture_id = v_pr.capture_id
   order by (ci.position = coalesce((select it.image_position from public.capture_item it
                                      where it.price_record_id = v_pr.id), 1)) desc, ci.position
   limit 1;

  return jsonb_build_object(
    'record', v_rec,
    'receipt_line', case when v_line.id is null then null else
      jsonb_build_object('id', v_line.id, 'receipt_id', v_line.receipt_id, 'line_no', v_line.line_no,
                         'raw_text', v_line.raw_text, 'quantity', v_line.quantity,
                         'unit_amount', v_line.unit_amount, 'line_amount', v_line.line_amount,
                         'updated_at', v_line.updated_at,
                         'attached', coalesce((select jsonb_agg(jsonb_build_object(
                                                  'id', a.id, 'line_type', a.line_type, 'raw_text', a.raw_text,
                                                  'quantity', a.quantity, 'line_amount', a.line_amount)
                                                  order by a.line_no)
                                                 from public.receipt_line a where a.applies_to_line_id = v_line.id),
                                              '[]'::jsonb)) end,
    'receipt_header', (select jsonb_build_object('id', r.id, 'status', r.status, 'transaction_date', r.transaction_date,
                                                 'transaction_time', r.transaction_time, 'total_amount', r.total_amount,
                                                 'store', app.store_json(r.store_id), 'branch', app.branch_json(r.branch_id),
                                                 'updated_at', r.updated_at)
                         from public.receipt r where r.id = v_line.receipt_id),
    'image', v_img,
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'entity_type', a.entity_type,
                                                             'action', a.action, 'actor_id', a.actor_id,
                                                             'before', a.before, 'after', a.after,
                                                             'created_at', a.created_at) order by a.created_at, a.id)
                           from public.audit_log a
                          where (a.entity_type = 'price_record' and a.entity_id = v_pr.id)
                             or (a.entity_type = 'receipt_line' and a.entity_id = v_pr.receipt_line_id)), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
-- R21 get_my_programs (S-19b, S-00c)
-- -----------------------------------------------------------------------------
create function public.get_my_programs() returns setof jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
           'program_id', mp.id, 'program_name', mp.name, 'status', mp.status,
           'store', app.store_json(mp.store_id),
           'is_member', exists (select 1 from public.household_program_membership m
                                 where m.member_program_id = mp.id
                                   and m.household_id = (app.my_household()).id))
    from public.member_program mp
    join public.store s on s.id = mp.store_id
   order by s.name, mp.name
$$;

-- -----------------------------------------------------------------------------
-- Hak akses (F-09): cabut default Supabase, beri authenticated secara eksplisit
-- -----------------------------------------------------------------------------
revoke all on public.price_record_view from public, anon, authenticated;
grant select on public.price_record_view to authenticated;
grant all on public.price_record_view to service_role;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('my_household', 'household_today', 'base_unit', 'unit_price_for',
                                'observation_price', 'product_lite', 'store_json', 'branch_json',
                                'price_point', 'product_card', 'resolve_product', 'receipt_duplicate') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('get_my_context', 'get_client_config', 'search_products', 'get_product_cards',
                                'get_offline_cache', 'find_product_by_barcode', 'get_product_detail',
                                'price_history', 'price_chart', 'price_trend', 'compare_sizes', 'where_cheaper',
                                'list_captures', 'get_capture', 'get_receipt', 'get_capture_items',
                                'recent_locations', 'get_active_session', 'merge_product_preview',
                                'price_record_detail', 'get_my_programs') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
