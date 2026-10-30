-- =============================================================================
-- 0100 (2026-10-30) · Matching: kunci tier di config + daftar pendek tier 4
-- (docs/08 §7.2, §8.2, §11.1 #1–#3; Tahap 6b M2/M3, bagian yang tidak bergantung D-16)
-- =============================================================================
-- Migration per milestone (F-136, D-95). Semua perubahan aditif; RLS tidak berubah.
--   * app.config: confidence per tier (§8.2), batas confidence AI tier 4, ambang daftar pendek.
--     Nilai default = konstanta lama, sehingga match_products menghasilkan nilai identik
--     (dibuktikan test L1 70_capture_pipeline yang tidak diubah).
--   * app.match_products: membaca kunci tier dari config; tier 3 = min(similarity, fuzzy_max_confidence).
--   * app.ai_match_shortlist(): daftar pendek kandidat untuk matcher AI tier 4 (§7.2). DEFINER,
--     EXECUTE hanya service_role (worker). Tidak pernah produk privat household lain.

insert into app.config (key, value, description) values
  ('match_conf_barcode',                 '1.00', 'Confidence tier 1 barcode (docs/08 §8.2)'),
  ('match_conf_alias_household',         '0.98', 'Confidence tier 2 alias household di toko yang sama (§8.2)'),
  ('match_conf_alias_global',            '0.95', 'Confidence tier 2 alias global di toko yang sama (§8.2)'),
  ('match_conf_alias_group',             '0.70', 'Confidence tier 2b alias dari toko lain dalam store_group (§8.2)'),
  ('fuzzy_max_confidence',               '1.00', 'Batas atas confidence tier 3: min(similarity, nilai ini) (F-111)'),
  ('ai_match_max_confidence',            '0.85', 'Batas atas confidence saran AI tier 4; < auto_save_min_confidence (§7.3, Q-108)'),
  ('ai_match_shortlist_min_similarity',  '0.2',  'Ambang word_similarity daftar pendek tier 4 (§7.2)');

-- -----------------------------------------------------------------------------
-- app.match_products: isi sama dengan 0320_pipeline, konstanta diganti config.
-- -----------------------------------------------------------------------------
create or replace function app.match_products(p_household uuid, p_store_id uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_item     jsonb;
  v_out      jsonb := '[]';
  v_text     text;
  v_date     date;
  v_min      numeric := app.config_numeric('fuzzy_min_similarity');
  v_fmax     numeric := app.config_numeric('fuzzy_max_confidence');
  v_c_bar    numeric := app.config_numeric('match_conf_barcode');
  v_c_hh     numeric := app.config_numeric('match_conf_alias_household');
  v_c_glob   numeric := app.config_numeric('match_conf_alias_global');
  v_c_group  numeric := app.config_numeric('match_conf_alias_group');
  v_cands    jsonb;
  v_best     jsonb;
  v_group    uuid := (select store_group_id from public.store where id = p_store_id);
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_text := app.normalize_text(v_item ->> 'raw_text');
    v_date := coalesce((v_item ->> 'date')::date, app.household_today(p_household));

    with
    -- Tier 1: barcode berlaku pada tanggal transaksi. GTIN: household dulu, lalu global.
    -- PLU: wajib store yang sama. Produk merged → ikuti merged_into_id (F-01).
    t1 as (
      select coalesce(p.merged_into_id, p.id) as product_id, 'barcode'::text as tier, v_c_bar as confidence,
             1 as prio, (ba.household_id is null)::int as sub
        from public.barcode_assignment ba
        join public.product p on p.id = ba.product_id
       where nullif(btrim(v_item ->> 'barcode'), '') is not null
         and ba.code = btrim(v_item ->> 'barcode')
         and (ba.household_id is null or ba.household_id = p_household)
         and ba.valid_from <= v_date and (ba.valid_until is null or ba.valid_until > v_date)
         and (ba.code_type = 'gtin' or ba.store_id = p_store_id)),
    -- Tier 2: alias exact per store; household menang atas global (D-35).
    t2 as (
      select a.product_id, 'alias'::text, case when a.household_id is null then v_c_glob else v_c_hh end,
             2, (a.household_id is null)::int
        from public.product_alias a
       where v_text is not null and a.status = 'active' and a.store_id = p_store_id
         and a.normalized_text = v_text
         and (a.household_id is null or a.household_id = p_household)),
    -- Tier 2b: alias dari store lain dalam store_group yang sama → kandidat saja (A-6).
    t2b as (
      select a.product_id, 'alias'::text, v_c_group, 3, (a.household_id is null)::int
        from public.product_alias a
        join public.store s on s.id = a.store_id
       where v_text is not null and v_group is not null and s.store_group_id = v_group
         and a.store_id <> p_store_id and a.status = 'active' and a.normalized_text = v_text
         and (a.household_id is null or a.household_id = p_household)),
    -- Tier 3: fuzzy word_similarity terhadap nama + varian + brand, dibatasi fuzzy_max_confidence (F-111).
    t3 as (
      select p.id, 'fuzzy'::text,
             least(round(extensions.word_similarity(v_text, p.search_text || ' ' || coalesce(b.normalized_name, ''))::numeric, 3), v_fmax),
             4, 0
        from public.product p
        left join public.brand b on b.id = p.brand_id
       where v_text is not null and p.status = 'active'
         and (p.household_id is null or p.household_id = p_household)
         and extensions.word_similarity(v_text, p.search_text || ' ' || coalesce(b.normalized_name, '')) >= v_min),
    allc as (
      select x.product_id, x.tier, x.confidence, x.prio, x.sub from t1 x
      union all select * from t2 union all select * from t2b union all select * from t3),
    ranked as (
      select distinct on (c.product_id) c.*
        from allc c
        join public.product p on p.id = c.product_id and p.status = 'active'
       order by c.product_id, c.prio, c.sub, c.confidence desc),
    top as (
      select * from ranked order by prio, sub, confidence desc, product_id limit 5)
    select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'tier', tier, 'confidence', confidence)
                              order by prio, sub, confidence desc, product_id), '[]')
      into v_cands from top;

    v_best := v_cands -> 0;
    v_out := v_out || jsonb_build_object(
      'key', v_item -> 'key',
      'product_id', v_best -> 'product_id',
      'tier', v_best -> 'tier',
      'confidence', v_best -> 'confidence',
      'candidates', v_cands);
  end loop;
  return v_out;
end $$;

-- -----------------------------------------------------------------------------
-- app.ai_match_shortlist (§7.2): kandidat untuk matcher AI tier 4
-- -----------------------------------------------------------------------------
-- Masukan p_items: [{key, raw_text}]. Keluaran: [{key, candidates: [{product_id, brand, name,
-- variant, size, sale_mode, category, similarity}]}], urut similarity, maks p_limit (1..50).
-- Kandidat: produk active, global atau privat milik p_household (aturan match_products), dengan
--   (a) word_similarity ≥ ai_match_shortlist_min_similarity, atau
--   (b) pernah dibeli household di toko ini (price_record active) dan kata pertamanya sama.
-- Worker mengirim indeks lokal ke model, bukan product_id (UUID tidak dikirim, §7.2).
create function app.ai_match_shortlist(p_household uuid, p_store uuid, p_items jsonb, p_limit integer default 15)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_item   jsonb;
  v_out    jsonb := '[]';
  v_text   text;
  v_first  text;
  v_min    numeric := app.config_numeric('ai_match_shortlist_min_similarity');
  v_limit  integer := greatest(1, least(coalesce(p_limit, 15), 50));
  v_cands  jsonb;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_text := app.normalize_text(v_item ->> 'raw_text');
    v_first := split_part(coalesce(v_text, ''), ' ', 1);

    with bought as (
      select distinct pr.product_id
        from public.price_record pr
       where p_store is not null and pr.household_id = p_household and pr.store_id = p_store
         and pr.status = 'active'),
    scored as (
      select p.id, p.name, p.variant, p.sale_mode, p.pack_count, p.content_size, p.content_unit,
             b.name as brand, c.name as category, p.search_text,
             round(extensions.word_similarity(v_text, p.search_text || ' ' || coalesce(b.normalized_name, ''))::numeric, 3) as sim
        from public.product p
        left join public.brand b on b.id = p.brand_id
        left join public.category c on c.id = p.category_id
       where v_text is not null and p.status = 'active'
         and (p.household_id is null or p.household_id = p_household)),
    picked as (
      select s.* from scored s
       where s.sim >= v_min
          or (v_first <> '' and split_part(s.search_text, ' ', 1) = v_first
              and s.id in (select product_id from bought))
       order by s.sim desc, s.id
       limit v_limit)
    select coalesce(jsonb_agg(jsonb_build_object(
             'product_id', x.id, 'brand', x.brand, 'name', x.name, 'variant', x.variant,
             'size', case when x.content_size is null then x.content_unit
                          else case when x.pack_count > 1 then x.pack_count || ' × ' else '' end
                               || trim_scale(x.content_size) || ' ' || x.content_unit end,
             'sale_mode', x.sale_mode, 'category', x.category, 'similarity', x.sim)
             order by x.sim desc, x.id), '[]')
      into v_cands from picked x;

    v_out := v_out || jsonb_build_object('key', v_item -> 'key', 'candidates', v_cands);
  end loop;
  return v_out;
end $$;

-- -----------------------------------------------------------------------------
-- Hak akses: hanya service_role (F-09)
-- -----------------------------------------------------------------------------
revoke all on function app.ai_match_shortlist(uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function app.ai_match_shortlist(uuid, uuid, jsonb, integer) to service_role;
