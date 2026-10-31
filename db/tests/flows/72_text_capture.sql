-- 72 · Struk tempelan dari Gemini (D-100, docs/08 §23): W1b submit_text_capture, penjaga kolom,
--      claim per sumber + engine run, R13 source, hapus tanpa gambar, retensi teks (Q-150).
\ir ../lib/harness.sql
\ir ../lib/seed.sql

-- ---------------------------------------------------------------------------
-- W1b submit_text_capture
-- ---------------------------------------------------------------------------
select test.login(test.uid('a'));
select test.expect_code($$select public.submit_text_capture('7e000000-0000-0000-0000-000000000001', 'price_label', '{"lines":[]}')$$,
                        'INVALID_INPUT', 'Q-147: hanya jenis struk');
select test.expect_code($$select public.submit_text_capture('7e000000-0000-0000-0000-000000000001', 'receipt', '   ')$$,
                        'INVALID_INPUT', 'teks kosong ditolak');
select test.expect_code($$select public.submit_text_capture('7e000000-0000-0000-0000-000000000001', 'receipt', repeat('x', 50001))$$,
                        'INVALID_INPUT', 'teks > 50.000 karakter ditolak');
select test.ok((select r ->> 'created' = 'true' and r ->> 'status' = 'uploaded'
                  from public.submit_text_capture('7e000000-0000-0000-0000-000000000001', 'receipt', '{"lines":[1]}') r),
               'W1b: capture teks terdaftar');
select test.ok((select r ->> 'created' = 'false'
                  from public.submit_text_capture('7e000000-0000-0000-0000-000000000001', 'receipt', '{"lain":1}') r)
               and (select pasted_text = '{"lines":[1]}' from public.capture where id = '7e000000-0000-0000-0000-000000000001'),
               'W1b: idempoten per id (D-59), teks pertama tetap');
select test.ok((select source = 'text' and household_id = test.hh('a') and uploaded_by = test.uid('a')
                  from public.capture where id = '7e000000-0000-0000-0000-000000000001')
               and not exists (select 1 from public.capture_image where capture_id = '7e000000-0000-0000-0000-000000000001'),
               'W1b: source text, tanpa capture_image');
-- Lokasi dari sesi belanja (pola W1).
insert into public.shopping_session (id, household_id, branch_id, started_at, expires_at)
values ('5e000000-0000-0000-0000-000000000072', test.hh('a'), '30000000-0000-0000-0000-000000000001',
        now() - interval '1 hour', now() + interval '2 hours');
select public.submit_text_capture('7e000000-0000-0000-0000-000000000002', 'receipt', '{}', '5e000000-0000-0000-0000-000000000072');
select test.ok((select store_id = '20000000-0000-0000-0000-000000000001' and branch_id = '30000000-0000-0000-0000-000000000001'
                  from public.capture where id = '7e000000-0000-0000-0000-000000000002'),
               'W1b: lokasi dari sesi belanja');

-- Penjaga kolom: authenticated punya UPDATE tabel capture (RLS), tapi sumber/teks tidak bisa diubah.
select test.expect_code($$update public.capture set pasted_text = 'diubah' where id = '7e000000-0000-0000-0000-000000000001'$$,
                        'INVALID_INPUT', 'pasted_text tidak bisa diubah');
select test.expect_code($$update public.capture set source = 'image' where id = '7e000000-0000-0000-0000-000000000001'$$,
                        'INVALID_INPUT', 'source tidak bisa diubah');

-- R13: source ikut keluar.
select test.ok((select bool_and((r ->> 'source') = 'text') from public.list_captures() r
                 where (r ->> 'id')::uuid in ('7e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000002')),
               'R13: source = text');
select test.ok((select (r -> 'capture' ->> 'source') = 'text' and (r -> 'images') = '[]'::jsonb
                  from public.get_capture('7e000000-0000-0000-0000-000000000001') r),
               'R14: capture teks tanpa gambar');
select test.logout();

-- RLS: user lain tidak melihat capture teks.
select test.login(test.uid('b'));
select test.ok(not exists (select 1 from public.capture where id = '7e000000-0000-0000-0000-000000000001'),
               'RLS: capture teks tidak terlihat household lain');
select test.logout();

-- Kolom tidak bisa dipakai untuk foto.
select test.expect_error($$insert into public.capture (household_id, kind, source, pasted_text)
                           values (test.hh('a'), 'receipt', 'image', 'x')$$,
                         'pasted_text hanya untuk source text');

-- ---------------------------------------------------------------------------
-- Klaim per sumber + engine run
-- ---------------------------------------------------------------------------
-- Satu capture foto lebih tua dari capture teks.
insert into public.capture (id, household_id, kind, status, uploaded_at)
values ('7e000000-0000-0000-0000-0000000000f1', test.hh('a'), 'receipt', 'uploaded', now() - interval '1 day');
select test.as_service();
create temp table c_text as
  select * from app.claim_next_capture('w', 'claude-vision', 'claude-opus-5-5', 'v1', array['text'], 'paste', 'paste-v1');
select test.ok((select count(*) = 1 and bool_and(source = 'text') and bool_and(pasted_text is not null)
                       and bool_and(images = '[]'::jsonb) from c_text),
               'p_sources = {text}: foto yang lebih tua dilewati, teks diklaim');
select test.ok((select ocr_engine = 'paste' and ai_model is null and prompt_version = 'paste-v1'
                  from public.processing_run where id = (select run_id from c_text)),
               'run capture teks memakai engine/prompt teks, tanpa model');
create temp table c_img as
  select * from app.claim_next_capture('w', 'claude-vision', 'claude-opus-5-5', 'v1', null, 'paste', 'paste-v1');
select test.ok((select capture_id = '7e000000-0000-0000-0000-0000000000f1' and source = 'image' and pasted_text is null from c_img)
               and (select ocr_engine = 'claude-vision' and ai_model = 'claude-opus-5-5' and prompt_version = 'v1'
                      from public.processing_run where id = (select run_id from c_img)),
               'tanpa filter: foto diklaim dengan engine foto');
create temp table c_text2 as select * from app.claim_next_capture('w-lama');
select test.ok((select count(*) = 1 and bool_and(source = 'text') from c_text2)
               and (select ocr_engine is null and prompt_version = 'w-lama'
                      from public.processing_run where id = (select run_id from c_text2)),
               'pemanggil lama (1 argumen) tetap bisa mengklaim');
select test.ok(not exists (select 1 from app.claim_next_capture('w', p_sources => array['image'])), 'antrean foto kosong');
select test.logout();

-- ---------------------------------------------------------------------------
-- W3 hapus capture teks gagal (tanpa gambar → tanpa job purge)
-- ---------------------------------------------------------------------------
update public.capture set status = 'failed', error_code = 'unsupported' where id = '7e000000-0000-0000-0000-000000000002';
select test.login(test.uid('a'));
select test.ok((select r ->> 'deleted' = 'true' and r -> 'purge_job_id' = 'null'::jsonb
                  from public.delete_capture('7e000000-0000-0000-0000-000000000002') r),
               'W3: capture teks dihapus tanpa job purge Storage');
select test.logout();

-- ---------------------------------------------------------------------------
-- Retensi teks (Q-150)
-- ---------------------------------------------------------------------------
update public.capture set uploaded_at = now() - interval '13 months' where id = '7e000000-0000-0000-0000-000000000001';
select test.ok((select (r ->> 'purge_text')::int = 1 from app.enqueue_retention() r), 'retensi: 1 teks tempelan jatuh tempo');
select test.ok((select pasted_text is null and source = 'text' from public.capture where id = '7e000000-0000-0000-0000-000000000001'),
               'retensi: teks tempelan > 12 bulan dikosongkan, capture tetap');
select test.ok((select (r ->> 'purge_text')::int = 0 from app.enqueue_retention() r), 'retensi teks idempoten');
