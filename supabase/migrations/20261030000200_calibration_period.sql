-- =============================================================================
-- 0200 (2026-10-30) · Masa kalibrasi matching M3 (docs/08 §8.2 no. 1, D-92; Tahap 6b M2)
-- =============================================================================
-- Selama masa kalibrasi semua item masuk konfirmasi: auto_save_min_confidence = 1,01 (> confidence
-- maksimum 1,00), saran sistem tetap tampil. Lama: 2 minggu atau ≥ 150 baris produk, mana yang lebih
-- lama. Sesudahnya τ final dari db/scripts/calibration_report.sql (M6, D-50).
--   * calibration_started_on: tanggal mulai, dibaca calibration_report.sql sebagai default `since`.
--     Nilai di sini = tanggal migration. Jika worker dengan extractor sungguhan baru dipakai
--     belakangan, ubah ke tanggal itu lewat SQL (docs/06 §2.10); tidak perlu migration baru.
-- Hanya data app.config; skema, RLS, dan RPC tidak berubah.

update app.config
   set value = '1.01',
       description = 'Ambang auto-save D-12. Masa kalibrasi M3: 1,01 = semua item dikonfirmasi (docs/08 §8.2); nilai final M6 (D-50)'
 where key = 'auto_save_min_confidence';

insert into app.config (key, value, description) values
  ('calibration_started_on', '"2026-10-30"',
   'Tanggal mulai masa kalibrasi matching (auto_save_min_confidence = 1,01); default since di calibration_report.sql (docs/08 §8.2)');
