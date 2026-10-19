-- Katalog contoh untuk pengembangan dan test (BUKAN seed produksi).
-- Dijalankan oleh Supabase CLI (`supabase db reset`) dan oleh db/tests/lib/seed.sql.
-- Semua baris global (household_id NULL), seperti hasil kurasi pemilik proyek (D-29).

insert into public.store_group (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Alfa Group');

insert into public.store (id, name, channel, store_group_id) values
  ('20000000-0000-0000-0000-000000000001', 'AEON',     'offline', null),
  ('20000000-0000-0000-0000-000000000002', 'Alfamart', 'offline', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', 'Alfamidi', 'offline', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000004', 'Shopee',   'online',  null);

insert into public.branch (id, store_id, kind, name, city) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'physical', 'AEON BSD',         'Tangerang'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'physical', 'Alfamart Serpong', 'Tangerang'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', 'physical', 'Alfamidi Ciputat', 'Tangerang');
insert into public.branch (id, store_id, kind, name, city, status, closed_at, successor_branch_id) values
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'physical', 'AEON Lama', 'Tangerang',
   'closed', '2025-12-31', '30000000-0000-0000-0000-000000000001');
insert into public.branch (id, store_id, kind, name, external_ref) values
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', 'seller', 'Nestle Official Store', 'nestle-official');

insert into public.member_program (id, store_id, name, status) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'AEON Member', 'active'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Alfagift',    'active'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'AEON Lama Club', 'discontinued');

insert into public.brand (id, name) values
  ('50000000-0000-0000-0000-000000000001', 'Nestle'),
  ('50000000-0000-0000-0000-000000000002', 'Indofood');

insert into public.product_group (id, name, brand_id, category_id)
select v.id::uuid, v.name, v.brand::uuid, c.id
  from (values ('60000000-0000-0000-0000-000000000001', 'Milo Original', '50000000-0000-0000-0000-000000000001', 'minuman'),
               ('60000000-0000-0000-0000-000000000002', 'Indomie Goreng', '50000000-0000-0000-0000-000000000002', 'makanan'))
       v(id, name, brand, slug)
  join public.category c on c.slug = v.slug;

insert into public.product (id, product_group_id, brand_id, category_id, name, variant, content_size, content_unit, pack_count, sale_mode)
select v.id::uuid, v.grp::uuid, v.brand::uuid, c.id, v.name, v.variant, v.size, v.unit, v.pack, v.mode
  from (values
    ('70000000-0000-0000-0000-000000000200', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'minuman', 'Milo Original', '200 g', 200::numeric, 'g', 1, 'unit'),
    ('70000000-0000-0000-0000-000000000500', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'minuman', 'Milo Original', '500 g', 500, 'g', 1, 'unit'),
    ('70000000-0000-0000-0000-000000000310', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'minuman', 'Milo 3in1', '10 x 35 g', 35, 'g', 10, 'unit'),
    ('70000000-0000-0000-0000-000000000180', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'minuman', 'Milo UHT', '180 ml', 180, 'ml', 1, 'unit'),
    ('70000000-0000-0000-0000-000000000085', '60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'makanan', 'Indomie Goreng', '85 g', 85, 'g', 1, 'unit'),
    ('70000000-0000-0000-0000-0000000000f1', null, null, 'makanan', 'Jeruk Medan', null, null, 'kg', 1, 'weight'))
       v(id, grp, brand, slug, name, variant, size, unit, pack, mode)
  join public.category c on c.slug = v.slug;

insert into public.barcode_assignment (product_id, code, code_type, store_id, valid_from) values
  ('70000000-0000-0000-0000-000000000500', '8992696404441', 'gtin', null, '2024-01-01'),
  ('70000000-0000-0000-0000-000000000200', '8992696404442', 'gtin', null, '2024-01-01'),
  ('70000000-0000-0000-0000-000000000085', '089686010947',  'gtin', null, '2024-01-01'),
  ('70000000-0000-0000-0000-0000000000f1', '2001',          'plu',  '20000000-0000-0000-0000-000000000002', '2024-01-01');

-- Alias global (hasil promosi D-35) untuk contoh matching tier 2.
insert into public.product_alias (store_id, product_id, alias_text, promoted_at) values
  ('20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000085', 'INDOMIE GRG 85G', now());
