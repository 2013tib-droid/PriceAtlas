-- Data uji bersama untuk db/tests/flows. Disertakan setelah harness.sql.
--   User a (Ani), b (Budi), c (Citra): signup → household otomatis.
--   Katalog global dari supabase/seed.sql.
insert into auth.users (id, email, last_sign_in_at) values
  ('00000000-0000-0000-0000-00000000000a', 'ani@example.com',   now()),
  ('00000000-0000-0000-0000-00000000000b', 'budi@example.com',  now()),
  ('00000000-0000-0000-0000-00000000000c', 'citra@example.com', now());

\ir ../../../supabase/seed.sql
