-- =============================================================================
-- 20261031000200 · Pembersih riwayat pg_cron (Tahap 7b B1, docs/09 §2 F-184, D-101 Q-158)
-- =============================================================================
-- pg_cron mencatat setiap run di cron.job_run_details tanpa batas (±11.500 baris/hari karena
-- summary-queue tiap 10 dtk). Riwayat > 7 hari dihapus harian 17:45 UTC (00:45 WIB, setelah
-- retention 17:35). Tidak mengubah skema app. Dilewati jika pg_cron tidak terpasang (PostgreSQL
-- biasa + stub, mode A): tanpa pg_cron tidak ada riwayat, jadi --dev-scheduler tidak perlu tugas ini.
do $migration$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron tidak terpasang: jadwal cron-cleanup dilewati';
    return;
  end if;

  -- cron.schedule dengan nama yang sama memperbarui jadwal (idempoten).
  perform cron.schedule('cron-cleanup', '45 17 * * *',
    $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
end
$migration$;
