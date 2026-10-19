// Penjadwal (docs/05 §1.4). Mode --dev-scheduler menggantikan pg_cron di lingkungan
// tanpa extension itu: memanggil fungsi SQL yang SAMA dengan interval yang SAMA
// seperti supabase/migrations/20261020000900_cron.sql. Sapuan unggahan yatim selalu
// dijalankan worker (butuh Storage), di semua mode.
import type { Db } from './db.ts';
import { log } from './log.ts';

export interface ScheduledTask {
  name: string;
  /** Interval tetap (ms), atau jam harian UTC "HH:MM". */
  every?: number;
  dailyUtc?: string;
  run: () => Promise<unknown>;
}

export function sqlTasks(db: Db): ScheduledTask[] {
  const q = (sql: string) => () => db.query(sql);
  return [
    { name: 'summary-queue', every: 10_000, run: q('select app.process_summary_queue(500)') },
    { name: 'sql-jobs', every: 60_000, run: q('select app.run_sql_jobs(50)') },
    { name: 'reap-stale-runs', every: 60_000, run: q('select app.reap_stale_runs()') },
    { name: 'summary-time', dailyUtc: '17:05', run: q('select app.enqueue_time_based_refresh()') },
    { name: 'alias-promote', dailyUtc: '17:20', run: q('select app.promote_aliases()') },
    { name: 'retention', dailyUtc: '17:35', run: q('select app.enqueue_retention()') },
  ];
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly lastRun = new Map<string, number>();
  private readonly lastDay = new Map<string, string>();
  private busy = false;

  constructor(
    private readonly tasks: ScheduledTask[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(tickMs = 1_000): void {
    this.timer = setInterval(() => void this.tick(), tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Jalankan tugas yang jatuh tempo. Dipisah supaya bisa diuji tanpa timer. */
  async tick(): Promise<string[]> {
    if (this.busy) return [];
    this.busy = true;
    const ran: string[] = [];
    try {
      const now = this.now();
      for (const t of this.tasks) {
        if (!this.due(t, now)) continue;
        try {
          await t.run();
          ran.push(t.name);
        } catch (e) {
          log('schedule.error', { task: t.name, error: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      this.busy = false;
    }
    return ran;
  }

  private due(t: ScheduledTask, now: Date): boolean {
    if (t.every) {
      const last = this.lastRun.get(t.name) ?? 0;
      if (now.getTime() - last < t.every) return false;
      this.lastRun.set(t.name, now.getTime());
      return true;
    }
    if (t.dailyUtc) {
      const day = now.toISOString().slice(0, 10);
      const hhmm = now.toISOString().slice(11, 16);
      if (hhmm < t.dailyUtc || this.lastDay.get(t.name) === day) return false;
      this.lastDay.set(t.name, day);
      return true;
    }
    return false;
  }
}
