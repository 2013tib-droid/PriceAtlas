-- 99 · Inventaris hak akses anon/authenticated = whitelist (F-09, docs/05 §7.2, §8.2).
-- Hak baru yang tidak ada di daftar, atau hak di daftar yang hilang, membuat test gagal.
-- Daftar dibangkitkan oleh db/scripts/gen_inventory_test.sh dan WAJIB ditinjau lewat diff.
\ir ../lib/harness.sql
\ir ../lib/privilege_inventory.sql

create table test.privilege_whitelist (role text, kind text, obj text, privs text);
insert into test.privilege_whitelist values
  ('anon', 'function', 'app.normalize_text(t text)', 'EXECUTE'),
  ('anon', 'table', 'public.public_price_fact', 'SELECT'),
  ('anon', 'table', 'public.unit', 'SELECT'),
  ('authenticated', 'column', 'public.capture_item.branch_id', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.currency', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.decided_at', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.decided_by', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.extra', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.is_bundle', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.member_price', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.member_program_id', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.normal_price', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.price_record_id', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.promo_min_qty', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.promo_price', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.promo_valid_from', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.promo_valid_until', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.seller_name', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.seller_ref', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.status', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.store_id', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.suggested_product_id', 'UPDATE'),
  ('authenticated', 'column', 'public.capture_item.transaction_date', 'UPDATE'),
  ('authenticated', 'column', 'public.household.default_currency', 'UPDATE'),
  ('authenticated', 'column', 'public.household.name', 'UPDATE'),
  ('authenticated', 'column', 'public.household.timezone', 'UPDATE'),
  ('authenticated', 'column', 'public.processing_run.capture_id', 'SELECT'),
  ('authenticated', 'column', 'public.processing_run.error_message', 'SELECT'),
  ('authenticated', 'column', 'public.processing_run.finished_at', 'SELECT'),
  ('authenticated', 'column', 'public.processing_run.household_id', 'SELECT'),
  ('authenticated', 'column', 'public.processing_run.id', 'SELECT'),
  ('authenticated', 'column', 'public.processing_run.started_at', 'SELECT'),
  ('authenticated', 'column', 'public.processing_run.status', 'SELECT'),
  ('authenticated', 'column', 'public.receipt.branch_id', 'INSERT,SELECT,UPDATE'),
  ('authenticated', 'column', 'public.receipt.capture_id', 'INSERT,SELECT'),
  ('authenticated', 'column', 'public.receipt.confirmed_at', 'INSERT,SELECT'),
  ('authenticated', 'column', 'public.receipt.created_at', 'SELECT'),
  ('authenticated', 'column', 'public.receipt.currency', 'INSERT,SELECT'),
  ('authenticated', 'column', 'public.receipt.duplicate_of_receipt_id', 'INSERT,SELECT'),
  ('authenticated', 'column', 'public.receipt.field_confidence', 'INSERT,SELECT'),
  ('authenticated', 'column', 'public.receipt.household_id', 'INSERT,SELECT'),
  ('authenticated', 'column', 'public.receipt.id', 'INSERT,SELECT'),
  ('authenticated', 'column', 'public.receipt.payment_method', 'INSERT,SELECT,UPDATE'),
  ('authenticated', 'column', 'public.receipt.status', 'INSERT,SELECT'),
  ('authenticated', 'column', 'public.receipt.store_id', 'INSERT,SELECT,UPDATE'),
  ('authenticated', 'column', 'public.receipt.subtotal_amount', 'INSERT,SELECT,UPDATE'),
  ('authenticated', 'column', 'public.receipt.total_amount', 'INSERT,SELECT,UPDATE'),
  ('authenticated', 'column', 'public.receipt.transaction_date', 'INSERT,SELECT,UPDATE'),
  ('authenticated', 'column', 'public.receipt.transaction_time', 'INSERT,SELECT,UPDATE'),
  ('authenticated', 'column', 'public.receipt.updated_at', 'SELECT'),
  ('authenticated', 'function', 'app.config_json(p_key text)', 'EXECUTE'),
  ('authenticated', 'function', 'app.config_numeric(p_key text)', 'EXECUTE'),
  ('authenticated', 'function', 'app.derive_receipt_price(p_line_id uuid, p_product_id uuid)', 'EXECUTE'),
  ('authenticated', 'function', 'app.err(p_code text, p_detail jsonb)', 'EXECUTE'),
  ('authenticated', 'function', 'app.jsonb_value_eq(a jsonb, b jsonb)', 'EXECUTE'),
  ('authenticated', 'function', 'app.my_household_ids()', 'EXECUTE'),
  ('authenticated', 'function', 'app.normalize_text(t text)', 'EXECUTE'),
  ('authenticated', 'function', 'app.upsert_receipt_record(p_line_id uuid, p_product_id uuid, p_outcome text, p_is_bundle boolean)', 'EXECUTE'),
  ('authenticated', 'function', 'app.valid_confidence_map(p_map jsonb, p_keys text[])', 'EXECUTE'),
  ('authenticated', 'function', 'app.valid_price_extra(p jsonb)', 'EXECUTE'),
  ('authenticated', 'function', 'public.merge_product(p_from uuid, p_into uuid)', 'EXECUTE'),
  ('authenticated', 'table', 'public.audit_log', 'SELECT'),
  ('authenticated', 'table', 'public.barcode_assignment', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.branch', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.brand', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.capture', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.capture_image', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.capture_item', 'SELECT'),
  ('authenticated', 'table', 'public.category', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.household', 'SELECT'),
  ('authenticated', 'table', 'public.household_member', 'SELECT'),
  ('authenticated', 'table', 'public.household_program_membership', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.member_program', 'SELECT'),
  ('authenticated', 'table', 'public.price_record', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.price_summary', 'SELECT'),
  ('authenticated', 'table', 'public.product', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.product_alias', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.product_group', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.profile', 'SELECT,UPDATE'),
  ('authenticated', 'table', 'public.public_price_fact', 'SELECT'),
  ('authenticated', 'table', 'public.receipt_adjustment', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.receipt_line', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.shopping_session', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.store', 'DELETE,INSERT,SELECT,UPDATE'),
  ('authenticated', 'table', 'public.store_group', 'SELECT'),
  ('authenticated', 'table', 'public.unit', 'SELECT');

do $$
declare
  v_extra   text;
  v_missing text;
begin
  select string_agg(format('%s %s %s [%s]', role, kind, obj, privs), E'\n') into v_extra
    from (select * from test.privilege_inventory except select * from test.privilege_whitelist) x;
  select string_agg(format('%s %s %s [%s]', role, kind, obj, privs), E'\n') into v_missing
    from (select * from test.privilege_whitelist except select * from test.privilege_inventory) x;
  perform test.ok(v_extra is null, 'tidak ada hak di luar whitelist' || coalesce(E':\n' || v_extra, ''));
  perform test.ok(v_missing is null, 'semua hak di whitelist ada' || coalesce(E':\n' || v_missing, ''));
  perform test.ok(not exists (select 1 from test.privilege_inventory
                               where role = 'anon' and kind <> 'function'
                                 and obj not in ('public.public_price_fact', 'public.unit')),
                  'anon hanya membaca public_price_fact dan unit');
  perform test.ok(not exists (select 1 from test.privilege_inventory
                               where obj like 'app.%' and kind <> 'function'),
                  'tabel schema app tidak terbuka untuk anon/authenticated');
  perform test.ok(not exists (select 1 from test.privilege_inventory
                               where role = 'anon' and kind = 'function' and obj like 'public.%'),
                  'anon tidak bisa menjalankan RPC apa pun');
  perform test.ok(not exists (select 1 from test.privilege_inventory
                               where obj in ('public.receipt.pii', 'public.processing_run.raw_ocr_text',
                                             'public.processing_run.raw_ai_output')
                                  or (obj in ('public.receipt', 'public.processing_run') and privs like '%SELECT%')),
                  'F-03/F-04: pii dan raw_* tidak terbaca');
end $$;
