-- 30 · confirm_receipt (§4.1, D-20, D-49, D-50, Q-23): duplikat, toko, keputusan baris,
--      alias, idempoten, cheaper_than_best_count.
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- Ringkasan lama: Milo 200 g terbaik 90 hari Rp100/g → struk Rp95/g lebih murah.
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date, effective_price, price_basis)
values (test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', 'price_label',
        current_date - 20, 20000, 'normal');
select app.process_summary_queue();

-- Struk lama (confirmed) dengan sidik jari sama: AEON, kemarin, 60.000.
insert into public.receipt (id, household_id, store_id, transaction_date, total_amount, status)
values ('90000000-0000-0000-0000-0000000000f0', test.hh('a'), '20000000-0000-0000-0000-000000000001', current_date - 1, 60000, 'confirmed');

-- Capture + struk draft hasil worker.
insert into public.capture (id, household_id, kind) values ('ca000000-0000-0000-0000-000000000001', test.hh('a'), 'receipt');
update public.capture set status = 'processing' where id = 'ca000000-0000-0000-0000-000000000001';
update public.capture set status = 'needs_confirmation' where id = 'ca000000-0000-0000-0000-000000000001';
insert into public.receipt (id, household_id, capture_id, store_id, branch_id, transaction_date, total_amount, status)
values ('90000000-0000-0000-0000-000000000001', test.hh('a'), 'ca000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', current_date - 1, 60000, 'draft');
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount, suggested_product_id, match_tier, match_confidence) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', test.hh('a'), 1, 'product', 'MILO ORI 200G', 1, 19000, 19000, '70000000-0000-0000-0000-000000000200', 'fuzzy', 0.62),
  ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', test.hh('a'), 2, 'product', 'MILO ORI 500G', 1, 45000, 45000, '70000000-0000-0000-0000-000000000500', 'alias', 0.95),
  ('91000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', test.hh('a'), 3, 'non_product', 'KANTONG', 1, 200, 200, null, null, null),
  ('91000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000001', test.hh('a'), 4, 'product', 'BRG XYZ', 1, 5000, 5000, null, null, null),
  ('91000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000001', test.hh('a'), 5, 'product', 'MILO 3N1 BOX', 1, 21000, 21000, '70000000-0000-0000-0000-000000000200', 'fuzzy', 0.55);
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000500', 'auto');

-- Draft kedua tanpa toko (D-49).
insert into public.receipt (id, household_id, transaction_date, total_amount, status)
values ('90000000-0000-0000-0000-000000000002', test.hh('a'), current_date, 1000, 'draft');

select test.login(test.uid('b'));
select test.expect_code($$select public.confirm_receipt('90000000-0000-0000-0000-000000000001', '[]')$$,
                        'NOT_FOUND', 'RLS: Budi tidak bisa mengonfirmasi struk Ani');

select test.login(test.uid('a'));
select test.expect_code($$select public.confirm_receipt('90000000-0000-0000-0000-000000000001', '[]')$$,
                        'DUPLICATE_DECISION_REQUIRED', 'D-20: duplikat sidik jari tanpa keputusan ditolak');
select test.expect_code($$select public.confirm_receipt('90000000-0000-0000-0000-000000000002', '[]')$$,
                        'RECEIPT_STORE_REQUIRED', 'D-49: konfirmasi tanpa toko ditolak');
select test.expect_code($$select public.confirm_receipt('90000000-0000-0000-0000-000000000001',
                          '[{"line_id": "91000000-0000-0000-0000-000000000001", "action": "accept"}]', 'distinct')$$,
                        'UNDECIDED_LINES', 'Q-23: baris produk tanpa keputusan ditolak');
select test.expect_code($$select public.confirm_receipt('90000000-0000-0000-0000-000000000001',
                          '[{"line_id": "91000000-0000-0000-0000-000000000003", "action": "accept"}]', 'distinct')$$,
                        'INVALID_INPUT', 'keputusan untuk baris non-produk ditolak');
select test.expect_code($$select public.confirm_receipt('90000000-0000-0000-0000-000000000001', '[]', 'mungkin')$$,
                        'INVALID_INPUT', 'keputusan duplikat tidak dikenal ditolak');
select test.ok((select status = 'draft' from public.receipt where id = '90000000-0000-0000-0000-000000000001'),
               'penolakan tidak mengubah apa pun (rollback)');

create temp table r1 as
select public.confirm_receipt('90000000-0000-0000-0000-000000000001', '[
  {"line_id": "91000000-0000-0000-0000-000000000001", "action": "accept"},
  {"line_id": "91000000-0000-0000-0000-000000000004", "action": "skip"},
  {"line_id": "91000000-0000-0000-0000-000000000005", "action": "replace", "product_id": "70000000-0000-0000-0000-000000000310"}
]', 'distinct') as r;
select test.ok((select (r ->> 'saved_count')::int = 3 and r ->> 'receipt_status' = 'confirmed'
                       and (r ->> 'cheaper_than_best_count')::int = 1 from r1),
               '§4.1: 3 record tersimpan, 1 lebih murah dari terbaik 90 hari');
select test.ok((select status = 'confirmed' and confirmed_at is not null and duplicate_of_receipt_id is null
                  from public.receipt where id = '90000000-0000-0000-0000-000000000001'),
               '§4.1: struk confirmed, penanda duplikat dilepas (distinct)');
select test.ok((select status = 'done' from public.capture where id = 'ca000000-0000-0000-0000-000000000001'),
               '§4.1: capture done lewat RPC');
select test.ok((select match_outcome = 'confirmed' and match_tier = 'fuzzy' and product_id = '70000000-0000-0000-0000-000000000200'
                  from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001'),
               'accept → produk saran, outcome confirmed, tier asli');
select test.ok((select match_outcome = 'corrected' and match_tier = 'fuzzy' and product_id = '70000000-0000-0000-0000-000000000310'
                  from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000005'),
               'replace → produk input, outcome corrected, tier saran tetap (metrik)');
select test.ok((select match_outcome = 'auto' from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000002'),
               'record auto-save tidak diubah');
select test.ok(not exists (select 1 from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000004'),
               'skip → tanpa record');
select test.ok((select count(*) = 2 and bool_and(household_id = test.hh('a') and store_id = '20000000-0000-0000-0000-000000000001')
                  from public.product_alias where household_id is not null),
               '§5.9: alias household untuk accept/replace, tidak untuk auto');
select test.ok((select product_id = '70000000-0000-0000-0000-000000000310' from public.product_alias
                 where normalized_text = 'milo 3n1 box'),
               'alias replace menunjuk produk koreksi');

-- Idempoten
select public.confirm_receipt('90000000-0000-0000-0000-000000000001', '[
  {"line_id": "91000000-0000-0000-0000-000000000001", "action": "accept"}]', 'distinct');
select test.ok((select count(*) = 3 from public.price_record where receipt_line_id is not null
                  and receipt_line_id in (select id from public.receipt_line where receipt_id = '90000000-0000-0000-0000-000000000001'))
               and (select count(*) = 2 from public.product_alias where household_id is not null),
               '§4.1: panggilan kedua idempoten (record dan alias tetap)');
select test.ok((select public.confirm_receipt('90000000-0000-0000-0000-000000000001', '[]') ->> 'replayed' = 'true'),
               'struk confirmed → hasil dikembalikan apa adanya');

-- ---------------------------------------------------------------------------
-- Buang duplikat
-- ---------------------------------------------------------------------------
select test.logout();
insert into public.capture (id, household_id, kind) values ('ca000000-0000-0000-0000-000000000002', test.hh('a'), 'receipt');
update public.capture set status = 'processing' where id = 'ca000000-0000-0000-0000-000000000002';
update public.capture set status = 'needs_confirmation' where id = 'ca000000-0000-0000-0000-000000000002';
insert into public.receipt (id, household_id, capture_id, store_id, transaction_date, total_amount, status, duplicate_of_receipt_id)
values ('90000000-0000-0000-0000-000000000003', test.hh('a'), 'ca000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000002', current_date - 3, 1, 'draft', '90000000-0000-0000-0000-0000000000f0');
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount, suggested_product_id) values
  ('91000000-0000-0000-0000-000000000031', '90000000-0000-0000-0000-000000000003', test.hh('a'), 1, 'product', 'MILO', 1, 19000, 19000, '70000000-0000-0000-0000-000000000200');
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000031', '70000000-0000-0000-0000-000000000200', 'auto');
select test.login(test.uid('a'));
select test.expect_code($$select public.confirm_receipt('90000000-0000-0000-0000-000000000003', '[]')$$,
                        'DUPLICATE_DECISION_REQUIRED', 'D-50: duplikat hash (ditandai worker) tetap butuh keputusan');
select public.confirm_receipt('90000000-0000-0000-0000-000000000003', '[]', 'discard');
select test.ok((select status = 'discarded' and duplicate_of_receipt_id = '90000000-0000-0000-0000-0000000000f0'
                  from public.receipt where id = '90000000-0000-0000-0000-000000000003'),
               'discard → struk discarded, menunjuk struk lama');
select test.ok((select status = 'void' from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000031'),
               'discard → record yang ada di-void');
select test.ok((select status = 'done' from public.capture where id = 'ca000000-0000-0000-0000-000000000002'),
               'discard → capture done');
select test.ok((select public.confirm_receipt('90000000-0000-0000-0000-000000000003', '[]', 'discard') ->> 'receipt_status' = 'discarded'),
               'discard idempoten');
select test.expect_code($$select public.confirm_receipt('90000000-0000-0000-0000-000000000003', '[]', 'distinct')$$,
                        'INVALID_STATE', 'struk discarded tidak bisa dikonfirmasi');

-- ---------------------------------------------------------------------------
-- non_product
-- ---------------------------------------------------------------------------
select test.logout();
insert into public.receipt (id, household_id, store_id, transaction_date, total_amount, status)
values ('90000000-0000-0000-0000-000000000004', test.hh('a'), '20000000-0000-0000-0000-000000000002', current_date, 777, 'draft');
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount, suggested_product_id) values
  ('91000000-0000-0000-0000-000000000041', '90000000-0000-0000-0000-000000000004', test.hh('a'), 1, 'product', 'DONASI', 1, 777, 777, '70000000-0000-0000-0000-000000000200');
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000041', '70000000-0000-0000-0000-000000000200', 'auto');
select test.login(test.uid('a'));
select public.confirm_receipt('90000000-0000-0000-0000-000000000004',
                              '[{"line_id": "91000000-0000-0000-0000-000000000041", "action": "non_product"}]');
select test.ok((select line_type = 'non_product' from public.receipt_line where id = '91000000-0000-0000-0000-000000000041')
               and not exists (select 1 from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000041'),
               'non_product → baris diubah, record auto dihapus');
select test.logout();
