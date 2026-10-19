-- 85 · RPC yang dipakai tools AI (docs/05 §6): hanya data household sendiri.
--      Tool → RPC: cari_harga_terbaik (R3/R7), tren_harga (R10), harga_per_satuan (R7),
--      bandingkan_ukuran (R11), lebih_hemat_di_mana (R12), histori_harga (R8).
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- Produk global yang sama, harga berbeda per household.
insert into public.price_record (id, household_id, product_id, store_id, branch_id, source_type, transaction_date,
                                 effective_price, price_basis)
values
  ('8a000000-0000-0000-0000-000000000001', test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001', 'price_label', current_date - 1, 19500, 'normal'),
  ('8a000000-0000-0000-0000-000000000002', test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001', 'price_label', current_date - 35, 20000, 'normal'),
  ('8b000000-0000-0000-0000-000000000001', test.hh('b'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002',
   '30000000-0000-0000-0000-000000000002', 'price_label', current_date - 1, 9999, 'normal'),
  ('8b000000-0000-0000-0000-000000000002', test.hh('b'), '70000000-0000-0000-0000-000000000500', '20000000-0000-0000-0000-000000000002',
   null, 'price_label', current_date - 2, 30000, 'normal');
select app.process_summary_queue();

create function test.tool_outputs() returns text
language sql as $$
  select concat_ws(' | ',
    (select jsonb_agg(x)::text from public.search_products('milo') x),
    public.get_product_detail('70000000-0000-0000-0000-000000000200')::text,
    public.price_trend('70000000-0000-0000-0000-000000000200')::text,
    (select jsonb_agg(x)::text from public.compare_sizes('60000000-0000-0000-0000-000000000001', 'all') x),
    (select jsonb_agg(x)::text from public.where_cheaper(p_group_id => '60000000-0000-0000-0000-000000000001', p_window_days => null) x),
    (select jsonb_agg(to_jsonb(x))::text from public.price_history('70000000-0000-0000-0000-000000000200') x))
$$;
grant execute on function test.tool_outputs() to authenticated;

select test.login(test.uid('a'));
select test.ok((select strpos(o, '8a000000-0000-0000-0000-000000000001') > 0 and strpos(o, '8b000000') = 0
                       and strpos(o, '9999') = 0 and strpos(o, 'Alfamart') = 0
                  from test.tool_outputs() o),
               'tools sebagai A: data A ada, data B (record, harga, toko) tidak ada');
select test.ok((select (x #>> '{summary,best_all,effective_price}')::numeric = 19500
                  from public.get_product_cards(array['70000000-0000-0000-0000-000000000200'::uuid]) x),
               'cari_harga_terbaik A: termurah milik A (19.500), bukan 9.999 milik B');
select test.ok((select count(*) = 1 from public.where_cheaper(p_group_id => '60000000-0000-0000-0000-000000000001', p_window_days => null)),
               'lebih_hemat_di_mana A: hanya toko tempat A punya data');
select test.ok((select (t ->> 'record_count')::int = 2 from public.price_trend('70000000-0000-0000-0000-000000000200') t),
               'tren_harga A: jumlah data hanya milik A');
select test.ok((select count(*) filter (where (x ->> 'has_data')::boolean) = 1
                  from public.compare_sizes('60000000-0000-0000-0000-000000000001', 'all') x),
               'bandingkan_ukuran A: Milo 500 g tanpa data (data B tidak terlihat)');

select test.login(test.uid('b'));
select test.ok((select strpos(o, '8b000000-0000-0000-0000-000000000001') > 0 and strpos(o, '8a000000') = 0
                       and strpos(o, '19500') = 0 and strpos(o, 'AEON BSD') = 0
                  from test.tool_outputs() o),
               'tools sebagai B: data B ada, data A tidak ada');
select test.ok((select count(*) = 1 and bool_and(id = '8b000000-0000-0000-0000-000000000001')
                  from public.price_history('70000000-0000-0000-0000-000000000200')),
               'histori_harga B: hanya 1 record milik B');

select test.login(test.uid('c'));
select test.ok((select strpos(o, '8a000000') = 0 and strpos(o, '8b000000') = 0 from test.tool_outputs() o),
               'tools sebagai C (tanpa data): tidak memuat data siapa pun');
select test.logout();

-- Tidak ada RPC tulis yang dipakai tool (D-57): semua RPC tool STABLE.
select test.ok((select bool_and(provolatile = 's') from pg_proc
                 where pronamespace = 'public'::regnamespace
                   and proname in ('search_products', 'get_product_detail', 'get_product_cards', 'price_trend',
                                   'compare_sizes', 'where_cheaper', 'price_history')),
               'D-57: semua RPC tool bersifat baca (STABLE)');
