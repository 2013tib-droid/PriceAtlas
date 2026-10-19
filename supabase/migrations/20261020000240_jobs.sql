-- =============================================================================
-- 0240 · Jenis job baru dan konfigurasi operasional (D-70; docs/05 §5.6)
-- =============================================================================

alter table app.job drop constraint job_kind_check;
alter table app.job add constraint job_kind_check
  check (kind in ('recompute_unit_price', 'promote_aliases', 'purge_images', 'redact_ocr',
                  'delete_household', 'share_existing_prices', 'purge_storage_paths'));

-- Nilai confidence per tier dan ambang adalah placeholder sampai uji OCR (D-16, D-70).
insert into app.config (key, value, description) values
  ('capture_max_attempts',               '3',              'Percobaan maksimum pemrosesan capture (§5.3)'),
  ('capture_processing_timeout_seconds', '300',            'Lease run: lebih lama dari ini → reaper (§5.3)'),
  ('capture_retry_backoff_seconds',      '[30, 120, 600]', 'Backoff retry otomatis per percobaan (§5.3)'),
  ('fuzzy_min_similarity',               '0.5',            'Ambang matching tier 3 (word_similarity)'),
  ('orphan_upload_ttl_hours',            '24',             'Umur unggahan yatim sebelum disapu (§5.2)'),
  ('ocr_redact_after_days',              '7',              'Redaksi OCR mentah N hari setelah capture final (§7.4)'),
  ('session_extend_hours',               '2',              'Perpanjangan sesi belanja (D-60)');
