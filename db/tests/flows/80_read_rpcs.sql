-- 80 · RPC baca R1–R21 (docs/05 §3.2, §3.4): search D-53/F-13, where_cheaper F-08,
--      tren D-54, compare_sizes per dimensi, dan bentuk payload layar.
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- ---------------------------------------------------------------------------
-- Data Ani (household a), ditulis sistem
-- ---------------------------------------------------------------------------
insert into public.store (id, household_id, name, channel)
values ('2a000000-0000-0000-0000-000000000001', test.hh('a'), 'AEON', 'offline');   -- privat, nama sama dengan global (F-08)
insert into public.product (id, name, content_size, content_unit, status) values
  ('70000000-0000-0000-0000-0000000000a9', 'Milo Arsip', 1, 'kg', 'archived');
insert into public.product (id, name, content_size, content_unit) values
  ('70000000-0000-0000-0000-0000000000d1', 'Milo Duplikat', 200, 'g');
select public.merge_product('70000000-0000-0000-0000-0000000000d1', '70000000-0000-0000-0000-000000000200');

insert into public.price_record (household_id, product_id, store_id, branch_id, source_type, transaction_date,
                                 currency, normal_price, promo_price, effective_price, price_basis, is_bundle,
                                 member_price, member_program_id)
select test.hh('a'), v.p::uuid, v.s::uuid, v.b::uuid, 'price_label', current_date - v.d, v.cur, v.n, v.pr, v.e, v.basis,
       v.bun, v.m, v.mp::uuid
  from (values
    ('70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 5,   'IDR', 19500, null::numeric, 19500, 'normal', false, 18000::numeric, '40000000-0000-0000-0000-000000000001'),
    ('70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 10,  'IDR', 19500, 18000, 18000, 'promo',  false, null, null),
    ('70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 15,  'IDR', 20000, null, 20000, 'normal', false, null, null),
    ('70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 40,  'IDR', 21000, null, 21000, 'normal', false, null, null),
    ('70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 45,  'IDR', 21000, null, 21000, 'normal', false, null, null),
    ('70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', null,                                   120, 'IDR', 19500, 15000, 15000, 'promo',  false, null, null),
    ('70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', null,                                   3,   'IDR', 10000, null, 10000, 'normal', true,  null, null),
    ('70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', null,                                   2,   'USD', 2,     null, 2,     'normal', false, null, null),
    ('70000000-0000-0000-0000-000000000200', '2a000000-0000-0000-0000-000000000001', null,                                   8,   'IDR', 19000, null, 19000, 'normal', false, null, null),
    ('70000000-0000-0000-0000-000000000500', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 7,   'IDR', 47500, null, 47500, 'normal', false, null, null),
    ('70000000-0000-0000-0000-000000000180', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 6,   'IDR', 6000,  null, 6000,  'normal', false, null, null))
  v(p, s, b, d, cur, n, pr, e, basis, bun, m, mp);
select app.process_summary_queue();

-- Data Budi (tidak boleh terlihat Ani)
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date, effective_price, price_basis)
values (test.hh('b'), '70000000-0000-0000-0000-000000000310', '20000000-0000-0000-0000-000000000001', 'price_label',
        current_date - 1, 21000, 'normal');
select app.process_summary_queue();

select test.login(test.uid('a'));

-- ---------------------------------------------------------------------------
-- R1 / R2 / R21
-- ---------------------------------------------------------------------------
select test.ok((select get_my_context ->> 'user_id' = test.uid('a')::text
                       and get_my_context #>> '{household,id}' = test.hh('a')::text
                       and get_my_context ->> 'role' = 'owner'
                       and get_my_context #>> '{household,timezone}' = 'Asia/Jakarta'
                       and (get_my_context #> '{household,share_prices_public}') = 'false'
                  from public.get_my_context()),
               'R1: konteks user, household, peran');
select test.ok((select (c -> 'auto_save_min_confidence')::numeric = 0.9 and (c -> 'near_best_threshold_pct')::int = 5
                       and (c -> 'session_extend_hours')::int = 2 and not c ? 'alias_promotion_threshold'
                  from public.get_client_config() c),
               'R2: config klien hanya kunci whitelist');
select test.ok((select count(*) = 3 and count(*) filter (where (x ->> 'is_member')::boolean) = 0
                  from public.get_my_programs() x),
               'R21: semua program terlihat, belum ada keanggotaan');

-- ---------------------------------------------------------------------------
-- R3 search_products (D-53, F-13)
-- ---------------------------------------------------------------------------
select test.ok((select count(*) >= 4 from public.search_products('milo')),
               'F-13: kata kunci pendek "milo" menemukan produk Milo');
select test.ok((select bool_and(x #>> '{product,brand_name}' = 'Nestle') and count(*) = 4
                  from public.search_products('nestle') x),
               'D-53: brand "nestle" menemukan 4 SKU Milo');
select test.ok((select array_agg(x #>> '{product,id}') @> array['70000000-0000-0000-0000-000000000200',
                                                                  '70000000-0000-0000-0000-000000000180']
                  from public.search_products('nestle') x),
               'D-53: hasil brand memuat SKU yang punya data');
select test.ok((with r as (select x, row_number() over () as n from public.search_products('milo') x)
                select max(n) filter (where x -> 'summary' <> 'null') < min(n) filter (where x -> 'summary' = 'null') from r),
               'D-53: produk tanpa histori di bawah produk yang punya data');
select test.ok((select (x #>> '{product,id}') = '70000000-0000-0000-0000-000000000310' and x -> 'summary' = 'null'
                  from public.search_products('milo 3in1') x limit 1),
               'D-53: produk katalog tanpa histori tetap tampil (data Budi tidak terlihat)');
select test.ok(not exists (select 1 from public.search_products('milo') x
                            where x #>> '{product,id}' in ('70000000-0000-0000-0000-0000000000a9', '70000000-0000-0000-0000-0000000000d1')),
               'D-53: produk merged/archived disaring');
select test.expect_code($$select public.search_products('m')$$, '22023', 'R3: kata kunci < 2 huruf ditolak');
select test.ok((select x ? 'match_score' from public.search_products('milo') x limit 1), 'R3: ada match_score');

-- ProductCard: harga terbaik, label, cabang tidak diketahui, hint member
select test.ok((select (x #>> '{summary,best_90d,effective_price}')::numeric = 18000
                       and x #>> '{summary,best_90d,price_basis}' = 'promo'
                       and x #>> '{summary,best_90d,store,name}' = 'Alfamart'
                       and (x #>> '{summary,best_all,effective_price}')::numeric = 15000
                       and x #> '{summary,best_all,branch}' = 'null'
                       and (x #>> '{summary,record_count}')::int = 7
                       and x #>> '{summary,trend_direction}' = 'down'
                       and (x #>> '{hints,bundle_only_count}')::int = 1
                       and (x #>> '{hints,member_not_counted,member_price}')::numeric = 18000
                       and x #>> '{hints,member_not_counted,program_name}' = 'AEON Member'
                       and x #>> '{product,base_unit}' = 'g'
                       and x #>> '{group,best_by_dimension,product_id}' = '70000000-0000-0000-0000-000000000200'
                  from public.get_product_cards(array['70000000-0000-0000-0000-000000000200'::uuid]) x),
               'ProductCard: 90 hari promo 18.000, all-time 15.000 tanpa cabang, 7 data, tren turun, hint');

-- ---------------------------------------------------------------------------
-- R4 / R5 / R6 / R7
-- ---------------------------------------------------------------------------
select test.ok((select array_agg(x #>> '{product,id}') = array['70000000-0000-0000-0000-000000000500',
                                                                 '70000000-0000-0000-0000-000000000200']
                  from public.get_product_cards(array['70000000-0000-0000-0000-000000000500'::uuid,
                                                       '70000000-0000-0000-0000-0000000000d1'::uuid]) x),
               'R4: urutan id dipertahankan dan id merged diikuti');
select test.expect_code($$select public.get_product_cards(array_fill(gen_random_uuid(), array[51]))$$, '22023',
                        'R4: maksimal 50 id');
select test.ok((select count(*) = 4 from public.get_offline_cache(array['70000000-0000-0000-0000-000000000085'::uuid], 50)),
               'R5: dilihat (1) + punya data (3)');
select test.ok((select x #>> '{product,id}' = '70000000-0000-0000-0000-000000000085'
                  from public.get_offline_cache(array['70000000-0000-0000-0000-000000000085'::uuid], 50) x limit 1),
               'R5: produk yang pernah dibuka di depan');

select test.ok(public.find_product_by_barcode('8992696404441') = '{"product_id": "70000000-0000-0000-0000-000000000500", "via_merge": false}',
               'R6: GTIN global');
select test.ok(public.find_product_by_barcode('2001') is null, 'R6: PLU tanpa toko tidak cocok');
select test.ok(public.find_product_by_barcode('2001', '20000000-0000-0000-0000-000000000002') ->> 'product_id'
                 = '70000000-0000-0000-0000-0000000000f1', 'R6: PLU cocok di toko yang sama');
select test.ok(public.find_product_by_barcode('0000000000000') is null, 'R6: kode tak dikenal → null');

select test.ok((select d ->> 'redirect_to' = '70000000-0000-0000-0000-000000000200'
                       and d #>> '{card,product,id}' = '70000000-0000-0000-0000-000000000200'
                  from public.get_product_detail('70000000-0000-0000-0000-0000000000d1') d),
               'R7: produk merged → redirect_to');
select test.ok((select d -> 'redirect_to' = 'null' and (d #>> '{trend_windows,cur_n}')::int = 4
                       and (d #>> '{trend_windows,prev_n}')::int = 2 and (d ->> 'group_sizes_count')::int = 4
                       and (d #>> '{last_record,date}')::date = current_date - 2
                  from public.get_product_detail('70000000-0000-0000-0000-000000000200') d),
               'R7: jendela tren 4 vs 2, 4 ukuran dalam group, record terakhir');
select test.expect_code($$select public.get_product_detail(gen_random_uuid())$$, 'NOT_FOUND', 'R7: NOT_FOUND');

-- ---------------------------------------------------------------------------
-- R8 / R9 / R10 (D-54)
-- ---------------------------------------------------------------------------
select test.ok((select count(*) = 9 from public.price_history('70000000-0000-0000-0000-000000000200')),
               'R8: histori memuat semua record aktif (termasuk bundle dan USD)');
select test.ok((select count(*) = 4 from public.price_history('70000000-0000-0000-0000-000000000200', false,
                                                              '20000000-0000-0000-0000-000000000001')),
               'R8: filter toko (S-05 → S-03)');
select test.ok((with p1 as (select * from public.price_history('70000000-0000-0000-0000-000000000200', p_limit => 4)),
                     last as (select transaction_date, id from p1 order by transaction_date, id limit 1),
                     p2 as (select h.* from last, public.price_history('70000000-0000-0000-0000-000000000200',
                                                     p_limit => 50, p_before_date => last.transaction_date, p_before_id => last.id) h)
                select (select count(*) from p2) = 5 and not exists (select 1 from p1 join p2 using (id))),
               'R8: cursor (tanggal, id) tanpa tumpang tindih');
select test.ok((select count(*) = 7 and bool_and(not r.is_bundle and r.currency = 'IDR')
                  from public.price_chart('70000000-0000-0000-0000-000000000200') c
                  join public.price_record r on r.id = c.record_id),
               'R9: grafik aktif, non-bundle, mata uang household (7 titik)');
select test.ok((select count(*) = 7 and bool_and(price_basis = 'normal')
                  from public.price_chart('70000000-0000-0000-0000-000000000200', true)),
               'R9: hanya harga normal');
select test.ok((select t ->> 'direction' = (select trend_direction from public.price_summary
                                              where product_id = '70000000-0000-0000-0000-000000000200')
                       and (t ->> 'pct')::numeric = (select trend_pct from public.price_summary
                                                      where product_id = '70000000-0000-0000-0000-000000000200')
                       and t ->> 'label' = 'vs 30 hari sebelumnya'
                       and (t ->> 'cur_n')::int = 4 and (t ->> 'prev_n')::int = 2
                  from public.price_trend('70000000-0000-0000-0000-000000000200') t),
               'D-54: tren R10 = tren ringkasan (30 hari vs 30 hari sebelumnya)');
select test.ok((select t ->> 'direction' = 'down' and (t ->> 'cur_n')::int = 4
                  from public.price_trend('70000000-0000-0000-0000-000000000200', true) t),
               'D-33: tren hanya harga normal');
select test.ok((select t -> 'direction' = 'null' and (t ->> 'record_count')::int = 1
                  from public.price_trend('70000000-0000-0000-0000-000000000500') t),
               'D-15: data kurang → arah null, jumlah data tetap ada');

-- ---------------------------------------------------------------------------
-- R11 compare_sizes: per dimensi
-- ---------------------------------------------------------------------------
select test.ok((select count(*) = 4 from public.compare_sizes('60000000-0000-0000-0000-000000000001')),
               'R11: semua SKU aktif group');
select test.ok((select bool_and(case x #>> '{product,id}'
                                  when '70000000-0000-0000-0000-000000000200' then (x ->> 'rank')::int = 1 and (x ->> 'pct_vs_best')::numeric = 0
                                  when '70000000-0000-0000-0000-000000000500' then (x ->> 'rank')::int = 2 and (x ->> 'pct_vs_best')::numeric = 5.6
                                  when '70000000-0000-0000-0000-000000000180' then (x ->> 'rank')::int = 1 and x ->> 'dimension' = 'volume'
                                  when '70000000-0000-0000-0000-000000000310' then x -> 'rank' = 'null' and not (x ->> 'has_data')::boolean
                                end)
                  from public.compare_sizes('60000000-0000-0000-0000-000000000001') x),
               'R11: peringkat per dimensi, SKU tanpa data rank null');
select test.ok((select x #>> '{product,id}' = '70000000-0000-0000-0000-000000000310'
                  from public.compare_sizes('60000000-0000-0000-0000-000000000001') x
                 where x ->> 'dimension' = 'mass' offset 2 limit 1),
               'R11: SKU tanpa data paling bawah di dimensinya');
select test.ok((select (x ->> 'unit_price')::numeric = 75
                  from public.compare_sizes('60000000-0000-0000-0000-000000000001', 'all') x
                 where x #>> '{product,id}' = '70000000-0000-0000-0000-000000000200'),
               'R11: jendela all memakai harga terbaik sepanjang masa');
select test.expect_code($$select public.compare_sizes('60000000-0000-0000-0000-000000000001', 'tahun')$$, '22023',
                        'R11: jendela tidak dikenal ditolak');

-- ---------------------------------------------------------------------------
-- R12 where_cheaper (F-08)
-- ---------------------------------------------------------------------------
select test.ok((select count(*) filter (where x #>> '{store,name}' = 'AEON') = 3
                       and count(distinct x #>> '{store,id}') filter (where x #>> '{store,name}' = 'AEON') = 2
                  from public.where_cheaper(p_product_id => '70000000-0000-0000-0000-000000000200') x),
               'F-08: AEON global dan AEON privat tidak tergabung (per id)');
select test.ok((select count(*) = 1 from public.where_cheaper(p_product_id => '70000000-0000-0000-0000-000000000200') x
                 where x ->> 'currency' = 'USD'),
               'R12: mata uang dipisah');
select test.ok((select x #>> '{successor_branch,name}' = 'AEON BSD'
                  from public.where_cheaper(p_product_id => '70000000-0000-0000-0000-000000000200') x
                 where x #>> '{branch,name}' = 'AEON Lama'),
               'R12: cabang tutup menyertakan penerus');
select test.ok((select count(distinct x ->> 'dimension') = 2
                  from public.where_cheaper(p_group_id => '60000000-0000-0000-0000-000000000001', p_window_days => null) x),
               'R12: group dipisah per dimensi');
select test.ok((select bool_and((x ->> 'n')::int >= 1) and count(*) filter (where (x ->> 'n')::int = 1) > 0
                  from public.where_cheaper(p_product_id => '70000000-0000-0000-0000-000000000200') x),
               'D-60: baris dengan 1 data tetap ikut');
select test.ok(not exists (select 1 from public.where_cheaper(p_product_id => '70000000-0000-0000-0000-000000000200', p_window_days => 30) x
                            where (x ->> 'last_date')::date <= current_date - 30),
               'R12: jendela hari');
select test.expect_code($$select public.where_cheaper()$$, '22023', 'R12: wajib salah satu id');

-- ---------------------------------------------------------------------------
-- R13 / R14 / R15 / R20: capture dan struk
-- ---------------------------------------------------------------------------
select test.logout();
insert into public.capture (id, household_id, kind, status) values
  ('ca000000-0000-0000-0000-000000000001', test.hh('a'), 'receipt', 'uploaded');
update public.capture set status = 'processing' where id = 'ca000000-0000-0000-0000-000000000001';
update public.capture set status = 'needs_confirmation' where id = 'ca000000-0000-0000-0000-000000000001';
insert into public.capture_image (capture_id, household_id, position, storage_path, sha256)
values ('ca000000-0000-0000-0000-000000000001', test.hh('a'), 1, test.hh('a') || '/ca000000-0000-0000-0000-000000000001/1.jpg', repeat('b', 64));
insert into public.receipt (id, household_id, capture_id, store_id, transaction_date, total_amount, status, pii, field_confidence)
values ('90000000-0000-0000-0000-000000000001', test.hh('a'), 'ca000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', current_date - 1, 40000, 'draft', '{"card_last4": "1234"}', '{"store": 0.95}'),
       ('90000000-0000-0000-0000-000000000002', test.hh('a'), null,
        '20000000-0000-0000-0000-000000000001', current_date - 1, 40000, 'confirmed', '{}', '{}');
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount, applies_to_line_id, suggested_product_id, match_tier, match_confidence) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', test.hh('a'), 1, 'product', 'MILO 200G', 2, 19500, 39000, null, '70000000-0000-0000-0000-000000000200', 'fuzzy', 0.6),
  ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', test.hh('a'), 2, 'discount', 'DISC MEMBER', null, null, -1000, '91000000-0000-0000-0000-000000000001', null, null, null),
  ('91000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', test.hh('a'), 3, 'non_product', 'KANTONG', 1, 200, 200, null, null, null, null);
select test.login(test.uid('a'));

select test.ok((select x ->> 'status' = 'needs_confirmation' and (x ->> 'needs_check_count')::int = 1
                       and x ->> 'store_name' = 'AEON' and not (x ->> 'date_is_upload')::boolean
                       and x ->> 'receipt_id' = '90000000-0000-0000-0000-000000000001'
                  from public.list_captures() x),
               'R13: daftar capture dengan jumlah perlu dicek');
select test.ok((select count(*) = 0 from public.list_captures(p_kind => 'price_label')), 'R13: filter jenis');
select test.ok((select jsonb_array_length(c -> 'images') = 1 and c ->> 'receipt_id' = '90000000-0000-0000-0000-000000000001'
                       and not (c::text like '%raw_ocr_text%')
                  from public.get_capture('ca000000-0000-0000-0000-000000000001') c),
               'R14: detail capture tanpa kolom raw_*');
select test.ok((select not (r::text like '%1234%') and not (r -> 'header' ? 'pii')
                       and r #>> '{duplicate,receipt_id}' = '90000000-0000-0000-0000-000000000002'
                       and (r #>> '{totals,lines_sum}')::numeric = 38200 and (r #>> '{totals,diff}')::numeric = 1800
                       and jsonb_array_length(r -> 'lines') = 2
                       and jsonb_array_length(r #> '{lines,0,attached}') = 1
                       and (r #>> '{lines,0,needs_check}')::boolean
                       and r #>> '{lines,0,suggestion,id}' = '70000000-0000-0000-0000-000000000200'
                       and r #>> '{member_hint,text}' = 'DISC MEMBER'
                       and r #>> '{member_hint,program_id}' = '40000000-0000-0000-0000-000000000001'
                       and not (r ->> 'membership_known')::boolean
                       and (r #>> '{field_confidence,store}')::numeric = 0.95
                  from public.get_receipt('90000000-0000-0000-0000-000000000001') r),
               'R15: struk tanpa pii, duplikat sidik jari, total, baris + lampiran, saran, member_hint');

select test.logout();
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000200', 'auto');
select test.login(test.uid('a'));
update public.price_record set extra = extra || '{"note": "cek"}' where receipt_line_id = '91000000-0000-0000-0000-000000000001';
select test.ok((select d #>> '{record,receipt_id}' = '90000000-0000-0000-0000-000000000001'
                       and d #>> '{receipt_line,raw_text}' = 'MILO 200G'
                       and jsonb_array_length(d #> '{receipt_line,attached}') = 1
                       and d #>> '{receipt_header,store,name}' = 'AEON'
                       and (d #>> '{image,position}')::int = 1
                       and jsonb_array_length(d -> 'history') = 1
                       and not (d::text like '%1234%')
                  from public.price_record_detail((select id from public.price_record
                                                    where receipt_line_id = '91000000-0000-0000-0000-000000000001')) d),
               'R20: detail record struk + baris + header + gambar + histori audit');

-- ---------------------------------------------------------------------------
-- R17 / R18 / R19
-- ---------------------------------------------------------------------------
select test.ok((select x #>> '{store,name}' = 'AEON' and x -> 'branch' = 'null' from public.recent_locations() x limit 1)
               and (select count(*) >= 4 from public.recent_locations()),
               'R17: lokasi terakhir dipakai, terbaru di atas');
select test.ok(public.get_active_session() is null, 'R18: tanpa sesi aktif → null');
insert into public.shopping_session (id, household_id, branch_id)
values ('5e000000-0000-0000-0000-000000000001', test.hh('a'), '30000000-0000-0000-0000-000000000001');
select test.ok((select s #>> '{branch,name}' = 'AEON BSD' and s #>> '{store,name}' = 'AEON'
                       and jsonb_array_length(s -> 'labels') = 0
                  from public.get_active_session() s),
               'R18: sesi aktif dengan toko dan cabang');
update public.shopping_session set started_at = now() - interval '5 hours', expires_at = now() - interval '1 hour';
select test.ok(public.get_active_session() is null, 'D-43: sesi kedaluwarsa dihitung saat query');

insert into public.product (id, household_id, name, content_size, content_unit)
values ('7a000000-0000-0000-0000-000000000001', test.hh('a'), 'Milo Kiloan Ani', 1, 'kg');
select test.ok((select p ->> 'can_merge' = 'true' and (p ->> 'size_mismatch')::boolean
                       and not (p ->> 'dimension_mismatch')::boolean
                  from public.merge_product_preview('7a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000200') p),
               'R19: pratinjau merge privat → global, beda ukuran (U-16)');
select test.ok((select p ->> 'reason' = 'source_global' and not (p ->> 'can_merge')::boolean
                  from public.merge_product_preview('70000000-0000-0000-0000-000000000500', '70000000-0000-0000-0000-000000000200') p),
               'R19: sumber global → tidak bisa (D-30)');
select test.ok((select p ->> 'reason' = 'already_merged'
                  from public.merge_product_preview('70000000-0000-0000-0000-0000000000d1', '70000000-0000-0000-0000-000000000200') p),
               'R19: sumber sudah merged ke target yang sama');
select test.ok((select (p ->> 'dimension_mismatch')::boolean
                  from public.merge_product_preview('7a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000180') p),
               'R19: beda dimensi ditandai');

-- Data Budi tidak pernah muncul
select test.ok(not exists (select 1 from public.where_cheaper(p_product_id => '70000000-0000-0000-0000-000000000310')),
               'RLS: where_cheaper tidak memuat data household lain');
select test.logout();
