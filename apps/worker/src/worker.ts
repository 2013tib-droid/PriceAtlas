// Proses worker long-running (D-61, §1.3): LISTEN capture_uploaded + polling cadangan
// tiap 5 detik. Memproses capture lalu job worker sampai antrean kosong.
import type pg from 'pg';
import type { Db } from './db.ts';
import { runNextJob, sweepOrphans } from './jobs/run-job.ts';
import { log } from './log.ts';
import { processNextCapture, type PipelineDeps } from './pipeline/process-capture.ts';
import { Scheduler, sqlTasks, type ScheduledTask } from './scheduler.ts';

export interface WorkerOptions extends PipelineDeps {
  pollMs?: number;
  devScheduler?: boolean;
  jobLeaseSeconds?: number;
}

export class Worker {
  private client: pg.PoolClient | null = null;
  private poll: NodeJS.Timeout | null = null;
  private scheduler: Scheduler | null = null;
  private draining: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(private readonly opts: WorkerOptions) {}

  get db(): Db {
    return this.opts.db;
  }

  async start(): Promise<void> {
    this.client = await this.db.connect();
    this.client.on('notification', () => this.kick());
    await this.client.query('listen capture_uploaded');
    this.poll = setInterval(() => this.kick(), this.opts.pollMs ?? 5_000);

    const tasks: ScheduledTask[] = [
      { name: 'orphan-sweep', dailyUtc: '17:50', run: () => sweepOrphans({ db: this.db, blob: this.opts.blob }) },
    ];
    if (this.opts.devScheduler) tasks.push(...sqlTasks(this.db));
    this.scheduler = new Scheduler(tasks);
    this.scheduler.start();
    log('worker.started', { worker: this.opts.workerId, devScheduler: !!this.opts.devScheduler });
    this.kick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.poll) clearInterval(this.poll);
    this.scheduler?.stop();
    await this.draining;
    if (this.client) {
      await this.client.query('unlisten *').catch(() => undefined);
      this.client.release();
    }
    log('worker.stopped', { worker: this.opts.workerId });
  }

  /** Picu pengurasan antrean; jika sedang berjalan, ulangi sekali setelahnya. */
  kick(): void {
    if (this.stopped) return;
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = this.drainOnce()
      .then(() => undefined)
      .catch((e) => log('worker.error', { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        this.draining = null;
        if (this.again && !this.stopped) {
          this.again = false;
          this.kick();
        }
      });
  }

  /**
   * Mode `--once` (docs/09 §3.3): kuras antrean sampai kosong, lalu (opsional, `--sweep`) sapuan
   * unggahan yatim yang di mode long-running dijadwalkan harian 17:50 UTC (F-185).
   */
  async runOnce(opts: { sweep?: boolean } = {}): Promise<{ processed: number; swept: number | null }> {
    const processed = await this.drainOnce();
    const swept = opts.sweep ? await sweepOrphans({ db: this.db, blob: this.opts.blob }) : null;
    return { processed, swept };
  }

  /** Proses semua capture yang siap, lalu semua job worker. Hasil: jumlah yang dikerjakan. */
  async drainOnce(): Promise<number> {
    let n = 0;
    while (!this.stopped && (await processNextCapture(this.opts))) n++;
    while (!this.stopped && (await runNextJob({ db: this.db, blob: this.opts.blob, leaseSeconds: this.opts.jobLeaseSeconds }))) n++;
    return n;
  }
}
