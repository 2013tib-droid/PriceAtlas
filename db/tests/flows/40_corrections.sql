-- 40 · Koreksi (§4.3, §5.10, D-23, D-41, F-11, F-03): correct_price_record, correct_receipt_line.
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- Observasi member (dibuat saat Ani member AEON) dan observasi lama tanpa snapshot.
insert into public.household_program_membership (household_id, member_program_id)
values (test.hh('a'), '40000000-0000-0000-0000-000000000001');
insert into public.price_record (id, household_id, product_id, store_id, source_type, transaction_date, normal_price,
                                 member_price, member_program_id, effective_price, price_basis, extra) values
  ('8a000000-0000-0000-0000-000000000001', test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001',
   'price_label', current_date - 2, 20000, 18000, '40000000-0000-0000-0000-000000000001', 18000, 'member', '{"member_eligible": true}'),
  ('8a000000-0000-0000-0000-000000000002', test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001',
   'price_label', current_date - 3, 20000, 18000, '40000000-0000-0000-0000-000000000001', 20000, 'normal', '{}');
delete from public.household_program_membership where household_id = test.hh('a');   -- keluar dari program

-- Struk dengan satu baris.
insert into public.receipt (id, household_id, store_id, transaction_date, total_amount, status, pii)
values ('90000000-0000-0000-0000-000000000001', test.hh('a'), '20000000-0000-0000-0000-000000000001', current_date - 1,
        39000, 'confirmed', '{"phone": "08123456789"}');
insert into public.receipt_line (id, receipt_id, household_id, line_no, line_type, raw_text, quantity, unit_amount, line_amount) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', test.hh('a'), 1, 'product', 'MILO ORI 500', 2, 19500, 39000);
select app.upsert_receipt_record('91000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000200', 'confirmed');
insert into public.product_alias (store_id, product_id, alias_text) values
  ('20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000200', 'MILO ORI 500');   -- alias global yang salah
delete from app.summary_refresh_queue;

create function test.ts(p_id uuid) returns timestamptz language sql stable as
$$ select updated_at from public.price_record where id = p_id $$;
create function test.line_ts(p_id uuid) returns timestamptz language sql stable as
$$ select updated_at from public.receipt_line where id = p_id $$;
grant execute on function test.ts(uuid), test.line_ts(uuid) to authenticated;

select test.login(test.uid('a'));

-- ---------------------------------------------------------------------------
-- correct_price_record: observasi
-- ---------------------------------------------------------------------------
select test.expect_code($$select public.correct_price_record('8a000000-0000-0000-0000-000000000001', '{"normal_price": 21000}', now() - interval '1 hour')$$,
                        'STALE_WRITE', 'W6: konkurensi optimistik');
select public.correct_price_record('8a000000-0000-0000-0000-000000000001', '{"member_price": 17500}',
                                   test.ts('8a000000-0000-0000-0000-000000000001'));
select test.ok((select price_basis = 'member' and effective_price = 17500 and extra -> 'member_eligible' = 'true'
                  from public.price_record where id = '8a000000-0000-0000-0000-000000000001'),
               'F-11: koreksi memakai snapshot member_eligible (bukan keanggotaan saat ini)');
select public.correct_price_record('8a000000-0000-0000-0000-000000000002', '{"normal_price": 19000}',
                                   test.ts('8a000000-0000-0000-0000-000000000002'));
select test.ok((select price_basis = 'normal' and effective_price = 19000 and extra -> 'member_eligible' = 'false'
                  from public.price_record where id = '8a000000-0000-0000-0000-000000000002'),
               'F-11: record lama tanpa snapshot → member_eligible = (price_basis = member)');
select test.expect_code(format($$select public.correct_price_record('8a000000-0000-0000-0000-000000000002', '{"normal_price": null}', %L)$$,
                               test.ts('8a000000-0000-0000-0000-000000000002')),
                        'NO_APPLICABLE_PRICE', 'W6: koreksi tanpa harga berlaku ditolak');
select test.expect_code(format($$select public.correct_price_record('8a000000-0000-0000-0000-000000000002', '{"extra": {"diskon": 1}}', %L)$$,
                               test.ts('8a000000-0000-0000-0000-000000000002')),
                        'INVALID_EXTRA', 'W6: extra di luar kontrak');
select public.correct_price_record('8a000000-0000-0000-0000-000000000002', '{"extra": {"note": "rak bawah", "member_eligible": true}}',
                                   test.ts('8a000000-0000-0000-0000-000000000002'));
select test.ok((select extra = '{"note": "rak bawah", "member_eligible": false}'
                  from public.price_record where id = '8a000000-0000-0000-0000-000000000002'),
               'W6: kunci sistem member_eligible tidak bisa diubah user');
select test.ok((select count(*) = 3 from public.audit_log where entity_type = 'price_record'), 'koreksi tercatat di audit_log');
select public.correct_price_record('8a000000-0000-0000-0000-000000000002', '{"normal_price": 19000}',
                                   test.ts('8a000000-0000-0000-0000-000000000002'));
select test.ok((select count(*) = 3 from public.audit_log where entity_type = 'price_record'), 'W6: patch tanpa perubahan idempoten');
select test.logout();
select test.ok((select count(*) = 1 from app.summary_refresh_queue where product_id = '70000000-0000-0000-0000-000000000200'),
               '§5.10: ringkasan masuk antrean setelah koreksi');
select test.login(test.uid('a'));

-- Pindah lokasi + tanggal observasi
select public.correct_price_record('8a000000-0000-0000-0000-000000000002',
                                   '{"store_id": "20000000-0000-0000-0000-000000000002", "transaction_date": "2026-01-01"}',
                                   test.ts('8a000000-0000-0000-0000-000000000002'));
select test.ok((select store_id = '20000000-0000-0000-0000-000000000002' and branch_id is null and transaction_date = '2026-01-01'
                  from public.price_record where id = '8a000000-0000-0000-0000-000000000002'),
               'W6: koreksi toko dan tanggal observasi');
select public.correct_price_record('8a000000-0000-0000-0000-000000000002', '{"status": "void"}',
                                   test.ts('8a000000-0000-0000-0000-000000000002'));
select test.ok((select status = 'void' from public.price_record where id = '8a000000-0000-0000-0000-000000000002'), 'W6: batalkan record');

-- ---------------------------------------------------------------------------
-- correct_price_record: struk
-- ---------------------------------------------------------------------------
create temp table rid as select id from public.price_record where receipt_line_id = '91000000-0000-0000-0000-000000000001';
select test.expect_code(format($$select public.correct_price_record(%L, '{"normal_price": 1}', %L)$$,
                               (select id from rid), test.ts((select id from rid))),
                        'USE_RECEIPT_LINE', 'D-23: angka record struk lewat correct_receipt_line');
select public.correct_price_record((select id from rid), '{"product_id": "70000000-0000-0000-0000-000000000500"}',
                                   test.ts((select id from rid)), true);
select test.ok((select product_id = '70000000-0000-0000-0000-000000000500' and match_outcome = 'corrected' and unit_price = 39
                  from public.price_record where id = (select id from rid)),
               'W6: ganti produk record struk → corrected, harga per satuan produk baru');
select test.ok((select product_id = '70000000-0000-0000-0000-000000000500' from public.product_alias
                 where household_id = test.hh('a') and normalized_text = 'milo ori 500'),
               'D-35: alias household baru menang atas alias global yang salah');
select test.ok((select product_id = '70000000-0000-0000-0000-000000000200' from public.product_alias
                 where household_id is null and normalized_text = 'milo ori 500'),
               'alias global tidak disentuh');

-- ---------------------------------------------------------------------------
-- correct_receipt_line
-- ---------------------------------------------------------------------------
select test.expect_code($$select public.correct_receipt_line('91000000-0000-0000-0000-000000000001', '{"quantity": 3}', now() - interval '1 hour')$$,
                        'STALE_WRITE', 'W7: konkurensi optimistik');
select public.correct_receipt_line('91000000-0000-0000-0000-000000000001', '{"quantity": 3, "line_amount": 58500}',
                                   test.line_ts('91000000-0000-0000-0000-000000000001'));
select test.ok((select quantity = 3 and effective_price = 19500 from public.price_record where id = (select id from rid)),
               'W7: ubah kuantitas → record terbentuk ulang');
create temp table l2 as
select public.correct_receipt_line('91000000-0000-0000-0000-000000000001', '{"add_discount": {"line_amount": 3000, "raw_text": "DISC"}}',
                                   test.line_ts('91000000-0000-0000-0000-000000000001')) as r;
select test.ok((select r #>> '{record,price_basis}' = 'promo' and (r #>> '{record,effective_price}')::numeric = 18500
                       and jsonb_array_length(r -> 'attached') = 1 and (r #>> '{attached,0,line_amount}')::numeric = -3000
                       and (r #>> '{attached,0,line_no}')::int = 2 from l2),
               'W7: diskon baru = baris discount line_no berikutnya → promo');
select test.ok((select count(*) = 1 from public.audit_log a
                 where a.entity_type = 'price_record' and a.entity_id = (select id from rid) and a.after ->> 'price_basis' = 'promo'),
               'W7: perubahan record turunan tercatat di audit');
select public.correct_receipt_line('91000000-0000-0000-0000-000000000001', '{"quantity": 3}',
                                   test.line_ts('91000000-0000-0000-0000-000000000001'));
select test.ok((select count(*) = 1 from public.receipt_line where applies_to_line_id = '91000000-0000-0000-0000-000000000001'),
               'W7: patch sama → idempoten');
select test.expect_code(format($$select public.correct_receipt_line('91000000-0000-0000-0000-000000000001', '{"raw_text": "x"}', %L)$$,
                               test.line_ts('91000000-0000-0000-0000-000000000001')),
                        'INVALID_INPUT', 'W7: kunci yang tidak diizinkan ditolak');

-- F-03: koreksi header struk tidak menyalin pii ke audit
update public.receipt set total_amount = 55500 where id = '90000000-0000-0000-0000-000000000001';
select test.ok((select count(*) = 1 and bool_and(not (before ? 'pii') and not (after ? 'pii'))
                  from public.audit_log where entity_type = 'receipt'),
               'F-03: audit koreksi struk tanpa kunci pii');
select test.ok(not exists (select 1 from public.audit_log where before::text like '%08123456789%' or after::text like '%08123456789%'),
               'F-03: nomor HP tidak ada di audit');

select test.logout();
update public.receipt set status = 'discarded' where id = '90000000-0000-0000-0000-000000000001';
select test.login(test.uid('a'));
select test.expect_code(format($$select public.correct_receipt_line('91000000-0000-0000-0000-000000000001', '{"quantity": 2}', %L)$$,
                               test.line_ts('91000000-0000-0000-0000-000000000001')),
                        'INVALID_STATE', 'W7: struk discarded tidak bisa dikoreksi');
select test.logout();
