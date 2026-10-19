-- =============================================================================
-- 0150 · Storage bucket `captures` dan policy (D-69, F-14; docs/05 §7.3)
-- =============================================================================
-- Path: {household_id}/{capture_id}/{position}.{ext}
-- User hanya SELECT + INSERT di folder household-nya. Tidak ada UPDATE/DELETE untuk
-- user: hapus file hanya oleh service role lewat Storage API (job purge_*).
-- Folder dibandingkan sebagai teks, sehingga nama folder bukan UUID tidak error.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy captures_read on storage.objects for select to authenticated
  using (bucket_id = 'captures'
         and (storage.foldername(name))[1] in (select app.my_household_ids()::text));

create policy captures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'captures'
              and (storage.foldername(name))[1] in (select app.my_household_ids()::text)
              and array_length(storage.foldername(name), 1) = 2);
