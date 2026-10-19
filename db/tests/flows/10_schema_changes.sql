-- 10 · Perubahan skema Tahap 4: D-48..D-52, D-55, X-10, F-03/04/06/07/10/15, D-68, D-71.
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- ---------------------------------------------------------------------------
-- D-50 / D-55 / F-10 / D-70: kunci config terbaca
-- ---------------------------------------------------------------------------
select test.ok(app.config_numeric('auto_save_min_confidence') = 0.90, 'D-50: auto_save_min_confidence = 0.90 (config_numeric)');
select test.ok(app.config_numeric('near_best_threshold_pct') = 5, 'D-55: near_best_threshold_pct = 5');
select test.ok(app.config_numeric('fuzzy_min_similarity') = 0.5
               and app.config_int('capture_max_attempts') = 3
               and app.config_int('capture_processing_timeout_seconds') = 300
               and app.config_json('capture_retry_backoff_seconds') = '[30, 120, 600]'::jsonb
               and app.config_int('orphan_upload_ttl_hours') = 24
               and app.config_int('ocr_redact_after_days') = 7
               and app.config_int('session_extend_hours') = 2,
               'D-70: kunci config operasional terbaca');
select test.ok(current_setting('TimeZone') = 'Asia/Jakarta', 'D-68: zona waktu database Asia/Jakarta');

-- ---------------------------------------------------------------------------
-- D-49: struk draft
-- ---------------------------------------------------------------------------
select test.login(test.uid('a'));
insert into public.receipt (id, household_id, transaction_date, total_amount, status)
values ('90000000-0000-0000-0000-000000000001', test.hh('a'), current_date, 10000, 'draft');
select test.ok(true, 'D-49: struk draft tanpa toko diterima');
select test.expect_code($$insert into public.receipt (household_id, transaction_date, total_amount, status)
                         values (test.hh('a'), current_date, 10000, 'confirmed')$$,
                        '23514', 'D-49: struk confirmed tanpa toko ditolak');
select test.expect_code($$insert into public.receipt (household_id, transaction_date, total_amount, field_confidence)
                         values (test.hh('a'), current_date, 1, '{"store": 1.2}')$$,
                        '23514', 'D-49: field_confidence di luar 0..1 ditolak');
select test.expect_code($$insert into public.receipt (household_id, transaction_date, total_amount, field_confidence)
                         values (test.hh('a'), current_date, 1, '{"warna": 0.5}')$$,
                        '23514', 'D-49: field_confidence kunci tidak dikenal ditolak');
select test.expect_code($$insert into public.receipt (household_id, transaction_date, total_amount, field_confidence)
                         values (test.hh('a'), current_date, 1, '{"date": "0.5"}')$$,
                        '23514', 'D-49: field_confidence nilai bukan angka ditolak');
insert into public.receipt (household_id, transaction_date, total_amount, field_confidence)
values (test.hh('a'), current_date, 1, '{"store": 0.4, "date": 1, "total": 0}');
select test.ok(true, 'D-49: field_confidence valid diterima');

-- F-06: cabang tanpa toko ditolak (receipt, capture, capture_item)
select test.expect_code($$insert into public.receipt (household_id, branch_id, transaction_date, total_amount)
                         values (test.hh('a'), '30000000-0000-0000-0000-000000000001', current_date, 1)$$,
                        '23514', 'F-06: receipt cabang tanpa toko ditolak');
select test.expect_code($$insert into public.capture (household_id, kind, branch_id)
                         values (test.hh('a'), 'price_label', '30000000-0000-0000-0000-000000000001')$$,
                        '23514', 'F-06: capture cabang tanpa toko ditolak');

-- ---------------------------------------------------------------------------
-- F-03: receipt.pii tidak terbaca authenticated
-- ---------------------------------------------------------------------------
select test.expect_code($$select pii from public.receipt$$, '42501', 'F-03: kolom pii tidak bisa di-select user');
select test.expect_code($$select * from public.receipt$$, '42501', 'F-03: select * ditolak (pii ikut)');
select test.ok((select count(*) from public.receipt) = 2, 'F-03: count(*) tetap jalan dengan hak per kolom');
select test.expect_code($$delete from public.receipt where id = '90000000-0000-0000-0000-000000000001'$$,
                        '42501', '§7.2: user tidak bisa menghapus struk langsung');
select test.expect_code($$update public.receipt set status = 'confirmed' where id = '90000000-0000-0000-0000-000000000001'$$,
                        '42501', '§7.2: receipt.status bukan kolom header');

-- F-04: processing_run select saja, tanpa raw_*
select test.logout();
insert into public.capture (id, household_id, kind, store_id)
values ('a1000000-0000-0000-0000-000000000001', test.hh('a'), 'price_label', '20000000-0000-0000-0000-000000000001');
insert into public.processing_run (capture_id, household_id, raw_ocr_text, raw_ai_output)
values ('a1000000-0000-0000-0000-000000000001', test.hh('a'), 'KARTU 1234', '{}');
select test.login(test.uid('a'));
select test.ok((select count(*) from public.processing_run) = 1, 'F-04: user membaca processing_run miliknya');
select test.expect_code($$select raw_ocr_text from public.processing_run$$, '42501', 'F-04: raw_ocr_text tidak terbaca');
select test.expect_code($$select raw_ai_output from public.processing_run$$, '42501', 'F-04: raw_ai_output tidak terbaca');
select test.expect_code($$insert into public.processing_run (capture_id, household_id)
                         values ('a1000000-0000-0000-0000-000000000001', test.hh('a'))$$,
                        '42501', 'F-04: user tidak bisa memalsukan run');
select test.expect_code($$update public.processing_run set status = 'failed'$$, '42501', 'F-04: user tidak bisa mengubah run');

-- F-15: penjaga transisi capture.status
select test.expect_code($$update public.capture set status = 'done' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                        'INVALID_TRANSITION', 'F-15: user tidak bisa menandai capture done');
select test.expect_code($$insert into public.capture (household_id, kind, status) values (test.hh('a'), 'price_label', 'done')$$,
                        'INVALID_TRANSITION', 'F-15: user hanya bisa membuat capture uploaded');
select test.logout();
select test.expect_code($$update public.capture set status = 'done' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                        'INVALID_TRANSITION', 'F-15: sistem pun tidak bisa uploaded → done');
update public.capture set status = 'processing' where id = 'a1000000-0000-0000-0000-000000000001';
select test.ok(true, 'F-15: sistem uploaded → processing');

-- D-71: error_code + captured_at
select test.expect_code($$update public.capture set error_code = 'meledak' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                        '23514', 'D-71: error_code di luar daftar ditolak');
update public.capture set error_code = 'blurry', captured_at = now() - interval '1 day'
 where id = 'a1000000-0000-0000-0000-000000000001';
select test.ok(true, 'D-71: error_code dan captured_at tersimpan');

-- ---------------------------------------------------------------------------
-- D-48: capture_item
-- ---------------------------------------------------------------------------
insert into public.capture_item (id, capture_id, household_id, position, raw_text, transaction_date, normal_price)
values ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', test.hh('a'), 1,
        'MILO 200G', current_date, 19500);
select test.ok(true, 'D-48: worker membuat capture_item');
select test.expect_code($$insert into public.capture_item (capture_id, household_id, position, raw_text, transaction_date, candidate_product_ids)
                         values ('a1000000-0000-0000-0000-000000000001', test.hh('a'), 2, 'x', current_date,
                                 array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()])$$,
                        '23514', 'D-48: kandidat maksimal 5');
select test.expect_code($$insert into public.capture_item (capture_id, household_id, position, raw_text, transaction_date, decided_at)
                         values ('a1000000-0000-0000-0000-000000000001', test.hh('a'), 3, 'x', current_date, now())$$,
                        '23514', 'D-48: pending tidak boleh punya decided_at');
select test.expect_code($$insert into public.capture_item (capture_id, household_id, position, raw_text, transaction_date, member_price)
                         values ('a1000000-0000-0000-0000-000000000001', test.hh('a'), 4, 'x', current_date, 1)$$,
                        '23514', 'D-48: harga member wajib menyebut program');
select test.expect_code($$insert into public.capture_item (capture_id, household_id, position, raw_text, transaction_date, branch_id)
                         values ('a1000000-0000-0000-0000-000000000001', test.hh('a'), 5, 'x', current_date, '30000000-0000-0000-0000-000000000001')$$,
                        '23514', 'F-06: capture_item cabang tanpa toko ditolak');
select test.expect_code($$insert into public.capture_item (capture_id, household_id, position, raw_text, transaction_date, field_confidence)
                         values ('a1000000-0000-0000-0000-000000000001', test.hh('a'), 6, 'x', current_date, '{"total": 1}')$$,
                        '23514', 'D-62: field_confidence item hanya product/price/date/store');

select test.login(test.uid('a'));
select test.expect_code($$insert into public.capture_item (capture_id, household_id, position, raw_text, transaction_date)
                         values ('a1000000-0000-0000-0000-000000000001', test.hh('a'), 9, 'x', current_date)$$,
                        '42501', 'D-48: user tidak bisa insert capture_item');
update public.capture_item set normal_price = 18900 where id = 'a2000000-0000-0000-0000-000000000001';
select test.ok((select normal_price from public.capture_item where id = 'a2000000-0000-0000-0000-000000000001') = 18900,
               'D-48: user mengubah item pending');
select test.expect_code($$update public.capture_item set status = 'accepted', decided_at = now()
                          where id = 'a2000000-0000-0000-0000-000000000001'$$,
                        'INVALID_STATE', 'D-48: keputusan item hanya lewat RPC');
select test.expect_code($$update public.capture_item set household_id = household_id$$, '42501',
                        'D-48: household_id item tidak bisa diubah user');
select test.logout();
select set_config('app.via_rpc', 'on', false);
update public.capture_item set status = 'rejected', decided_at = now() where id = 'a2000000-0000-0000-0000-000000000001';
select set_config('app.via_rpc', '', false);
select test.login(test.uid('a'));
select test.expect_code($$update public.capture_item set normal_price = 1 where id = 'a2000000-0000-0000-0000-000000000001'$$,
                        'INVALID_STATE', 'D-48: item yang sudah diputuskan tidak bisa diubah');
select test.logout();

-- ---------------------------------------------------------------------------
-- X-10 / D-52 / D-66: kontrak extra
-- ---------------------------------------------------------------------------
select test.ok(app.valid_price_extra('{}'), 'X-10: {} valid');
select test.ok(app.valid_price_extra('{"shipping_fee": 9000, "shop_voucher": 0, "cashback": 1500.5, "points": 10,
                                      "listing_title": "Milo 1kg", "listing_url": "https://shopee.co.id/x",
                                      "member_note": "Alfagift Rp17.900", "member_eligible": true,
                                      "member_hint": {"text": "DISC MEMBER", "program_id": "40000000-0000-0000-0000-000000000001"},
                                      "note": "catatan"}'),
               'X-10: semua kunci yang dikenal diterima');
select test.ok(not app.valid_price_extra('{"warna": "merah"}'), 'X-10: kunci tidak dikenal ditolak');
select test.ok(not app.valid_price_extra('{"shipping_fee": "9000"}'), 'X-10: tipe salah ditolak');
select test.ok(not app.valid_price_extra('{"cashback": -1}'), 'X-10: nominal negatif ditolak');
select test.ok(not app.valid_price_extra('{"listing_url": "http://shopee.co.id"}'), 'X-10: listing_url wajib https');
select test.ok(not app.valid_price_extra(jsonb_build_object('member_note', repeat('x', 201))), 'X-10: member_note maks 200');
select test.ok(not app.valid_price_extra('{"member_hint": {"text": "x", "lain": 1}}'), 'X-10: member_hint kunci lain ditolak');
select test.ok(not app.valid_price_extra('{"member_hint": {"program_id": "bukan-uuid", "text": "x"}}'), 'X-10: member_hint program_id wajib uuid');
select test.ok(not app.valid_price_extra('{"member_eligible": "ya"}'), 'X-10: member_eligible wajib boolean');
select test.ok(not app.valid_price_extra('[]'), 'X-10: extra wajib objek');

select test.login(test.uid('a'));
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date,
                                 effective_price, price_basis, extra)
values (test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002',
        'price_label', current_date, 19500, 'normal', '{"member_note": "Alfagift Rp17.900"}');
select test.ok(true, 'D-52: member_note di price_record diterima');
select test.expect_code($$insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date,
                             effective_price, price_basis, extra)
                         values (test.hh('a'), '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002',
                                 'price_label', current_date, 1, 'normal', '{"diskon": 1}')$$,
                        '23514', 'X-10: CHECK price_record menolak kunci tidak dikenal');
select test.logout();
select test.expect_code($$insert into public.capture_item (capture_id, household_id, position, raw_text, transaction_date, extra)
                         values ('a1000000-0000-0000-0000-000000000001', test.hh('a'), 7, 'x', current_date, '{"shipping_fee": -5}')$$,
                        '23514', 'X-10: CHECK capture_item.extra');

-- ---------------------------------------------------------------------------
-- D-51 / D-67: opt-in publik
-- ---------------------------------------------------------------------------
select test.ok((select not share_prices_public from public.household where id = test.hh('a')), 'D-51: default tidak berbagi');
select test.login(test.uid('a'));
select test.expect_code($$update public.household set share_prices_public = true$$, '42501',
                        'D-51: share_prices_public tidak bisa diubah langsung');
update public.household set name = 'Rumah Ani';
select test.ok((select name from public.household) = 'Rumah Ani', 'household.name tetap bisa diubah owner');
insert into public.price_record (id, household_id, product_id, store_id, source_type, transaction_date,
                                 effective_price, price_basis, visibility)
values ('80000000-0000-0000-0000-0000000000a1', test.hh('a'), '70000000-0000-0000-0000-000000000200',
        '20000000-0000-0000-0000-000000000001', 'price_label', current_date, 19500, 'normal', 'public');
select test.ok((select visibility from public.price_record where id = '80000000-0000-0000-0000-0000000000a1') = 'private',
               'D-67: visibility dari klien diabaikan (household belum opt-in)');
select test.logout();
update public.household set share_prices_public = true where id = test.hh('a');
select test.login(test.uid('a'));
insert into public.price_record (id, household_id, product_id, store_id, source_type, transaction_date,
                                 effective_price, price_basis, visibility)
values ('80000000-0000-0000-0000-0000000000a2', test.hh('a'), '70000000-0000-0000-0000-000000000200',
        '20000000-0000-0000-0000-000000000001', 'price_label', current_date, 19000, 'normal', 'private');
select test.ok((select visibility from public.price_record where id = '80000000-0000-0000-0000-0000000000a2') = 'public',
               'D-67: record baru mengikuti household yang opt-in');
select test.logout();
select test.ok((select count(*) from public.public_price_fact) = 1, 'D-25: record publik global terproyeksi');

-- ---------------------------------------------------------------------------
-- F-07: ringkasan hanya mata uang default household
-- ---------------------------------------------------------------------------
insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date,
                                 currency, effective_price, price_basis)
values (test.hh('b'), '70000000-0000-0000-0000-000000000500', '20000000-0000-0000-0000-000000000001',
        'price_label', current_date, 'USD', 2, 'normal'),
       (test.hh('b'), '70000000-0000-0000-0000-000000000500', '20000000-0000-0000-0000-000000000001',
        'price_label', current_date - 1, 'IDR', 45000, 'normal');
select app.process_summary_queue();
select test.ok((select record_count = 1 and best_all_effective_price = 45000 from public.price_summary
                 where household_id = test.hh('b') and product_id = '70000000-0000-0000-0000-000000000500'),
               'F-07: record USD tidak ikut ringkasan household IDR');

-- ---------------------------------------------------------------------------
-- F-09: default privileges ala Supabase aktif di stub, objek Tahap 4 tetap tertutup
-- ---------------------------------------------------------------------------
create table public.zz_probe (id int);
select test.ok(has_table_privilege('anon', 'public.zz_probe', 'select'), 'F-09: stub meniru default privileges Supabase');
drop table public.zz_probe;
select test.ok(not has_table_privilege('anon', 'public.capture_item', 'select')
               and not has_table_privilege('authenticated', 'public.capture_item', 'insert'),
               'F-09: capture_item dicabut dari anon, insert dicabut dari authenticated');
