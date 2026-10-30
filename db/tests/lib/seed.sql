-- Data uji bersama untuk db/tests/flows. Disertakan setelah harness.sql.
--   User a (Ani), b (Budi), c (Citra): signup → household otomatis.
--   Katalog global dari supabase/seed.sql.
insert into auth.users (id, email, last_sign_in_at) values
  ('00000000-0000-0000-0000-00000000000a', 'ani@example.com',   now()),
  ('00000000-0000-0000-0000-00000000000b', 'budi@example.com',  now()),
  ('00000000-0000-0000-0000-00000000000c', 'citra@example.com', now());

\ir ../../../supabase/seed.sql

-- Masa kalibrasi (migration …0200, docs/08 §8.2): auto_save_min_confidence = 1,01 di database.
-- Test memakai τ setelah kalibrasi (0,90) supaya perilaku auto-save D-12 tetap teruji; nilai
-- migration dan perilaku masa kalibrasi diuji di flows/89_calibration_period.sql.
update app.config set value = '0.90' where key = 'auto_save_min_confidence';
