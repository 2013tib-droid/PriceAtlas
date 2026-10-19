-- =============================================================================
-- 0100 · Helper konfigurasi dan error (D-50, D-55, F-10; docs/05 §2.2, §3.1)
-- =============================================================================

-- F-10: config_int() meng-cast ke integer, sehingga 0.90 tidak terbaca.
-- DEFINER: dipakai juga oleh RPC INVOKER, sedangkan app.config tidak terbaca authenticated.
create function app.config_numeric(p_key text) returns numeric
language sql stable security definer
set search_path = ''
as $$ select (value #>> '{}')::numeric from app.config where key = p_key $$;

-- Nilai jsonb mentah (mis. array backoff).
create function app.config_json(p_key text) returns jsonb
language sql stable security definer
set search_path = ''
as $$ select value from app.config where key = p_key $$;

insert into app.config (key, value, description) values
  ('auto_save_min_confidence', '0.90', 'Ambang auto-save D-12. Nilai final setelah uji OCR (D-16, D-50)'),
  ('near_best_threshold_pct',  '5',    'Batas "mendekati harga terbaik" di Cek harga rak dan sesi (D-55)');

-- Error bisnis (§3.1). PostgREST memetakan SQLSTATE PTnnn ke HTTP nnn.
--   message = kode (mis. STALE_WRITE), detail = json, hint = pesan Indonesia.
create function app.err(p_code text, p_detail jsonb default null) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_http text;
  v_hint text;
begin
  select e.http, e.hint into v_http, v_hint
    from (values
      ('NOT_FOUND',                   '404', 'Data tidak ditemukan.'),
      ('STALE_WRITE',                 '409', 'Data sudah diubah di tempat lain. Muat ulang lalu coba lagi.'),
      ('INVALID_STATE',               '409', 'Status data tidak mengizinkan aksi ini.'),
      ('INVALID_TRANSITION',          '409', 'Perubahan status ini tidak diizinkan.'),
      ('DUPLICATE_DECISION_REQUIRED', '409', 'Struk ini mirip struk lain. Pilih: simpan sebagai struk berbeda atau buang.'),
      ('SESSION_NOT_ACTIVE',          '409', 'Sesi belanja sudah berakhir.'),
      ('RECEIPT_STORE_REQUIRED',      '422', 'Pilih toko untuk struk ini.'),
      ('UNDECIDED_LINES',             '422', 'Masih ada baris yang belum diputuskan.'),
      ('STORE_REQUIRED',              '422', 'Pilih toko untuk harga ini.'),
      ('NO_APPLICABLE_PRICE',         '422', 'Tidak ada harga yang berlaku. Isi harga normal.'),
      ('USE_RECEIPT_LINE',            '422', 'Harga dari struk diubah lewat baris struknya.'),
      ('RECEIPT_DERIVED_FIELD',       '422', 'Angka harga dari struk diturunkan dari baris struk dan tidak bisa diubah langsung.'),
      ('INVALID_EXTRA',               '422', 'Info tambahan tidak valid.'),
      ('CAPTURE_IMAGES_MISSING',      '422', 'Gambar belum selesai diunggah.'),
      ('BRANCH_CLOSED',               '422', 'Cabang ini sudah tutup.'),
      ('RECORDS_NOT_OWNED',           '403', 'Sebagian data bukan milikmu.'),
      ('MERGE_FORBIDDEN',             '403', 'Produk ini tidak bisa digabungkan.'),
      ('REAUTH_REQUIRED',             '401', 'Masuk ulang dulu untuk melanjutkan.'),
      ('FORBIDDEN',                   '403', 'Tidak berhak melakukan aksi ini.'),
      ('INVALID_INPUT',               '400', 'Input tidak valid.')
    ) as e(code, http, hint)
   where e.code = p_code;

  if v_http is null then
    raise exception 'Kode error tidak dikenal: %', p_code;
  end if;

  raise exception using
    errcode = 'PT' || v_http,
    message = p_code,
    detail  = coalesce(p_detail, '{}'::jsonb)::text,
    hint    = v_hint;
end $$;

-- F-09: setiap fungsi baru dicabut eksplisit dari public/anon/authenticated.
revoke all on function app.config_numeric(text)   from public, anon, authenticated;
revoke all on function app.config_json(text)      from public, anon, authenticated;
revoke all on function app.err(text, jsonb)       from public, anon, authenticated;
grant execute on function app.config_numeric(text), app.config_json(text), app.err(text, jsonb)
  to authenticated, service_role;
