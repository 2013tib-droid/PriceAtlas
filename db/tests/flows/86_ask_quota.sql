-- 86 · Tanya: kuota dan biaya (docs/08 §10.4, §11.1 #4 #5, §12.3; 6b M5).
--      begin_ask (harian, bulanan, anggaran global, dua sesi bersamaan), record_ask_usage
--      (hanya household sendiri, sekali per pertanyaan, batas nilai), app.ai_spend_today.
\ir ../lib/harness.sql
\ir ../lib/seed.sql
create extension if not exists dblink with schema test;

-- Hasil begin_ask sebagai teks: 'ok:<n>' atau kode error (untuk sesi kedua lewat dblink).
create function test.try_begin_ask() returns text
language plpgsql as $$
declare v jsonb;
begin
  v := public.begin_ask();
  return 'ok:' || (v->>'questions_today');
exception when others then
  return sqlerrm;
end $$;
grant execute on function test.try_begin_ask() to authenticated;

-- ---------------------------------------------------------------------------
-- Konfigurasi dan hak akses
-- ---------------------------------------------------------------------------
select test.ok((select app.config_int('ask_daily_limit') = 30 and app.config_int('ask_monthly_limit') = 300
                       and app.config_numeric('ai_daily_budget_usd') = 2.00),
               '§11.1 #1: kunci config Tanya (30/hari, 300/bulan, US$2/hari)');

select test.login(test.uid('a'));
select test.expect_code($$select * from app.ask_usage$$, '42501', 'ask_usage tidak terbaca user');
select test.expect_code($$select app.ai_spend_today()$$, '42501', 'ai_spend_today hanya service role');
select test.logout();
set role anon;
select test.expect_code($$select public.begin_ask()$$, '42501', 'anon tidak bisa begin_ask');
reset role;

-- ---------------------------------------------------------------------------
-- begin_ask: hitungan dan kuota harian
-- ---------------------------------------------------------------------------
update app.config set value = '3' where key = 'ask_daily_limit';
select test.login(test.uid('a'));
create temp table r1 as select public.begin_ask() as v;
select test.ok((select (v->>'questions_today')::int = 1 and (v->>'daily_limit')::int = 3
                       and (v->>'questions_month')::int = 1 and (v->>'monthly_limit')::int = 300
                       and (v->>'day')::date = app.household_today(test.hh('a')) from r1),
               'begin_ask pertama: 1 dari 3, hari = hari ini zona household');
select public.begin_ask();
select public.begin_ask();
select test.expect_code($$select public.begin_ask()$$, 'AI_QUOTA_EXCEEDED', 'pertanyaan ke-4 > batas harian 3');
select test.expect_code($$select public.begin_ask()$$, 'PT429', 'kuota habis = PT429 (HTTP 429)');
reset role;
select test.ok((select questions = 3 from app.ask_usage where household_id = test.hh('a')),
               'pertanyaan yang ditolak tidak dihitung');

do $$
declare v_detail text;
begin
  perform test.login(test.uid('a'));
  begin
    perform public.begin_ask();
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  perform test.ok(v_detail::jsonb = '{"reason": "daily", "limit": 3}', 'detail.reason = daily + limit');
  perform test.logout();
end $$;

-- Household lain tidak terpengaruh.
select test.login(test.uid('b'));
select test.ok((public.begin_ask()->>'questions_today')::int = 1, 'kuota per household: Budi tetap bisa bertanya');
reset role;

-- ---------------------------------------------------------------------------
-- Kuota bulanan: hari-hari sebelumnya di bulan yang sama dihitung, bulan lalu tidak
-- ---------------------------------------------------------------------------
update app.config set value = '30' where key = 'ask_daily_limit';
update app.config set value = '10' where key = 'ask_monthly_limit';
insert into app.ask_usage (household_id, day, questions)
select test.hh('c'), d, 4
  from (values (date_trunc('month', app.household_today(test.hh('c')))::date - 1)) v(d);  -- bulan lalu
select test.login(test.uid('c'));
select test.ok((public.begin_ask()->>'questions_month')::int = 1, 'bulan lalu tidak dihitung ke kuota bulanan');
reset role;
-- Isi 9 pertanyaan di bulan berjalan (hari ini sudah 1 → total 9; hari lain hanya jika bukan tanggal 1).
update app.ask_usage set questions = 9 where household_id = test.hh('c') and day = app.household_today(test.hh('c'));
select test.login(test.uid('c'));
select test.ok((public.begin_ask()->>'questions_month')::int = 10, 'pertanyaan ke-10 bulan ini masih boleh');
select test.expect_code($$select public.begin_ask()$$, 'AI_QUOTA_EXCEEDED', 'pertanyaan ke-11 > batas bulanan 10');
reset role;
do $$
declare v_detail text;
begin
  perform test.login(test.uid('c'));
  begin perform public.begin_ask(); exception when others then get stacked diagnostics v_detail = pg_exception_detail; end;
  perform test.ok(v_detail::jsonb->>'reason' = 'monthly', 'detail.reason = monthly');
  perform test.logout();
end $$;
update app.config set value = '300' where key = 'ask_monthly_limit';

-- ---------------------------------------------------------------------------
-- Dua sesi bersamaan: baris household-hari dikunci, hitungan tidak hilang
-- ---------------------------------------------------------------------------
delete from app.ask_usage where household_id = test.hh('a');
update app.config set value = '2' where key = 'ask_daily_limit';
select test.login(test.uid('a'));
select public.begin_ask();                  -- 1 dari 2
reset role;
select test.dblink_connect('s2', 'dbname=' || current_database() || ' user=postgres');
select * from test.dblink('s2', $$select 1 from test.login('00000000-0000-0000-0000-00000000000a')$$) as t(x int);

begin;
select test.login(test.uid('a'));
select public.begin_ask();                  -- 2 dari 2, baris terkunci sampai commit
-- Sesi kedua mulai saat sesi pertama masih memegang kunci: harus menunggu, lalu melihat 2.
select test.dblink_send_query('s2', 'select test.try_begin_ask()');
select pg_sleep(0.3);
select test.ok(test.dblink_is_busy('s2') = 1, 'sesi kedua menunggu kunci baris household-hari');
reset role;
commit;
select test.ok((select r from test.dblink_get_result('s2') as t(r text)) = 'AI_QUOTA_EXCEEDED',
               'sesi kedua setelah kunci dilepas: kuota habis (tidak ada lost update)');
select test.dblink_disconnect('s2');
select test.ok((select questions = 2 from app.ask_usage where household_id = test.hh('a')),
               'dua sesi: hitungan tetap 2 (batas tidak terlampaui)');
update app.config set value = '30' where key = 'ask_daily_limit';

-- ---------------------------------------------------------------------------
-- record_ask_usage: household sendiri, sekali per pertanyaan, batas nilai
-- ---------------------------------------------------------------------------
select test.login(test.uid('a'));
select public.record_ask_usage(app.household_today(test.hh('a')), 1200, 300, 0.0108);
reset role;
select test.ok((select recorded = 1 and input_tokens = 1200 and output_tokens = 300 and cost_usd = 0.0108
                  from app.ask_usage where household_id = test.hh('a')),
               'record_ask_usage menambah token + biaya household sendiri');
select test.ok((select recorded = 0 and cost_usd = 0 from app.ask_usage where household_id = test.hh('b')),
               'household lain tidak tersentuh');

select test.login(test.uid('a'));
select public.record_ask_usage(app.household_today(test.hh('a')), 10, 5, null);
select test.expect_code($$select public.record_ask_usage(app.household_today(test.hh('a')), 1, 1, 0.01)$$,
                        'INVALID_STATE', 'tidak bisa mencatat lebih banyak dari pertanyaan yang dihitung (2)');
select test.expect_code($$select public.record_ask_usage(app.household_today(test.hh('a')) - 2, 1, 1, 0.01)$$,
                        'INVALID_INPUT', 'hari di luar hari ini/kemarin ditolak');
select test.expect_code($$select public.record_ask_usage(app.household_today(test.hh('a')), -1, 1, 0.01)$$,
                        'INVALID_INPUT', 'token negatif ditolak');
select test.expect_code($$select public.record_ask_usage(app.household_today(test.hh('a')), 1, 1, 5)$$,
                        'INVALID_INPUT', 'biaya > US$1 per pertanyaan ditolak');
reset role;
select test.ok((select recorded = 2 and input_tokens = 1210 and cost_usd = 0.0108
                  from app.ask_usage where household_id = test.hh('a')),
               'biaya NULL (model tak dikenal): token dicatat, biaya tidak');

-- Citra tidak bisa mencatat ke baris Budi: hanya household sendiri (baris Citra sudah penuh tercatat? belum).
select test.login(test.uid('c'));
select public.record_ask_usage(app.household_today(test.hh('c')), 1, 1, 0);
reset role;
select test.ok((select recorded = 0 from app.ask_usage where household_id = test.hh('b'))
               and (select recorded = 1 from app.ask_usage where household_id = test.hh('c')
                                                          and day = app.household_today(test.hh('c'))),
               'record_ask_usage hanya menulis baris household pemanggil');

-- User tanpa household.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'dewi@example.com');
delete from public.household_member where user_id = '00000000-0000-0000-0000-00000000000d';
select test.login('00000000-0000-0000-0000-00000000000d');
select test.expect_code($$select public.begin_ask()$$, 'FORBIDDEN', 'tanpa household → FORBIDDEN');
select test.expect_code($$select public.record_ask_usage(current_date, 1, 1, 0)$$, 'FORBIDDEN',
                        'record tanpa household → FORBIDDEN');
reset role;

-- ---------------------------------------------------------------------------
-- app.ai_spend_today + anggaran global
-- ---------------------------------------------------------------------------
select test.ok(app.ai_spend_today() = 0.0108, 'ai_spend_today = Σ ask_usage hari ini (belum ada processing_run)');
insert into public.capture (id, household_id, kind, uploaded_by)
values ('ca860000-0000-0000-0000-000000000001', test.hh('a'), 'receipt', test.uid('a'));
insert into public.processing_run (capture_id, household_id, status, cost_usd, started_at) values
  ('ca860000-0000-0000-0000-000000000001', test.hh('a'), 'failed', 0.5, now()),
  ('ca860000-0000-0000-0000-000000000001', test.hh('a'), 'failed', 0.7, current_date::timestamptz - interval '1 second'),
  ('ca860000-0000-0000-0000-000000000001', test.hh('a'), 'failed', null, now());
insert into app.ask_usage (household_id, day, questions, recorded, cost_usd)
values (test.hh('b'), current_date - 1, 1, 1, 0.9);
select test.ok(app.ai_spend_today() = 0.5108,
               'ai_spend_today: processing_run hari ini (zona DB) + Tanya hari ini; kemarin dan NULL tidak dihitung');

update app.config set value = '0.5' where key = 'ai_daily_budget_usd';
select test.login(test.uid('b'));
select test.expect_code($$select public.begin_ask()$$, 'AI_QUOTA_EXCEEDED', 'anggaran AI harian habis → 429');
reset role;
do $$
declare v_detail text;
begin
  perform test.login(test.uid('b'));
  begin perform public.begin_ask(); exception when others then get stacked diagnostics v_detail = pg_exception_detail; end;
  perform test.ok(v_detail::jsonb->>'reason' = 'budget', 'detail.reason = budget');
  perform test.logout();
end $$;
update app.config set value = '2.00' where key = 'ai_daily_budget_usd';
select test.login(test.uid('b'));
select test.ok((public.begin_ask()->>'questions_today')::int = 2, 'anggaran dinaikkan → boleh lagi');
reset role;

-- ---------------------------------------------------------------------------
-- Hapus household → baris kuota ikut terhapus (cascade)
-- ---------------------------------------------------------------------------
delete from public.household where id = test.hh('b');
select test.ok(not exists (select 1 from app.ask_usage a
                             where not exists (select 1 from public.household h where h.id = a.household_id)),
               'ask_usage ikut terhapus bersama household');
