-- =============================================================================
-- 0900 · Jadwal pg_cron (docs/05 §1.4, D-61, D-68: job harian 17:05 UTC = 00:05 WIB)
-- =============================================================================
-- Dilewati jika extension pg_cron tidak tersedia (PostgreSQL biasa + stub, mode A).
-- Di lingkungan tanpa pg_cron, worker `--dev-scheduler` memanggil fungsi yang sama
-- dengan interval yang sama (apps/worker/src/scheduler.ts).
do $migration$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron tidak tersedia: jadwal dilewati (pakai worker --dev-scheduler)';
    return;
  end if;

  create extension if not exists pg_cron;

  perform cron.schedule('summary-queue',    '10 seconds', $$select app.process_summary_queue(500)$$);
  perform cron.schedule('summary-time',     '5 17 * * *', $$select app.enqueue_time_based_refresh()$$);
  perform cron.schedule('alias-promote',    '20 17 * * *', $$select app.promote_aliases()$$);
  perform cron.schedule('sql-jobs',         '* * * * *',  $$select app.run_sql_jobs(50)$$);
  perform cron.schedule('reap-stale-runs',  '* * * * *',  $$select app.reap_stale_runs()$$);
  perform cron.schedule('retention',        '35 17 * * *', $$select app.enqueue_retention()$$);
end
$migration$;
