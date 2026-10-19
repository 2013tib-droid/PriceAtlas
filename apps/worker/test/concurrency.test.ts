// L3: konkurensi 2 worker, crash setelah claim → reaper, dan dev scheduler.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from '@priceatlas/testkit';
import { createPool } from '../src/db.ts';
import { Scheduler, sqlTasks } from '../src/scheduler.ts';
import { Worker } from '../src/worker.ts';
import { captureRow, setupEnv, skipBackoff, submitFixture, type Env } from './helpers.ts';

let env: Env;
beforeAll(() => {
  env = setupEnv('priceatlas_l3_concurrency');
});
afterAll(async () => {
  await env.close();
});

describe('dua worker paralel (SKIP LOCKED)', () => {
  it('setiap capture diproses tepat satu kali', async () => {
    const names = ['struk-aeon', 'label-milo', 'shopee-milo', 'struk-buram', 'shopee-milo', 'label-milo', 'struk-aeon', 'struk-buram'];
    const ids: string[] = [];
    for (const [i, n] of names.entries()) ids.push((await submitFixture(env, n, { user: i % 2 ? USERS.a : USERS.b })).captureId);

    const db2 = createPool(env.url, { role: 'service_role', max: 4 });
    const w1 = new Worker({ ...env.deps, workerId: 'w1' });
    const w2 = new Worker({ ...env.deps, db: db2, workerId: 'w2' });
    const [n1, n2] = await Promise.all([w1.drainOnce(), w2.drainOnce()]);
    await db2.end();

    expect(n1 + n2).toBe(ids.length);
    const runs = await env.admin.query<{ capture_id: string; n: number; workers: string[] }>(
      `select capture_id, count(*)::int as n, array_agg(distinct prompt_version) as workers
         from public.processing_run where capture_id = any($1) group by capture_id`,
      [ids],
    );
    expect(runs.rows.length).toBe(ids.length);
    expect(runs.rows.every((r) => r.n === 1)).toBe(true);
    const st = await env.admin.query<{ status: string }>('select status from public.capture where id = any($1)', [ids]);
    expect(st.rows.every((r) => ['done', 'needs_confirmation', 'failed'].includes(r.status))).toBe(true);
  });
});

describe('crash setelah claim (§5.3 lease)', () => {
  it('proses mati → run macet → reaper → worker lain menyelesaikan', async () => {
    const { captureId } = await submitFixture(env, 'shopee-milo');
    const tsx = resolve(import.meta.dirname, '../node_modules/.bin/tsx');
    const child = spawnSync(tsx, [resolve(import.meta.dirname, 'crash-child.ts')], {
      env: { ...process.env, CRASH_DB_URL: env.url, CRASH_BLOB_DIR: env.blob.rootDir },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(child.status).toBe(1);
    expect(child.stdout).toContain(`CLAIMED ${captureId}`);
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'processing' });

    // Belum lewat lease → reaper tidak menyentuh.
    expect((await env.workerDb.query('select app.reap_stale_runs() as n')).rows[0].n).toBe(0);
    await env.admin.query(`update public.processing_run set started_at = now() - interval '301 seconds'
                            where capture_id = $1 and status = 'running'`, [captureId]);
    expect((await env.workerDb.query('select app.reap_stale_runs() as n')).rows[0].n).toBe(1);
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'uploaded' });

    await skipBackoff(env, captureId);
    const w = new Worker({ ...env.deps, workerId: 'w-rescue' });
    expect(await w.drainOnce()).toBeGreaterThanOrEqual(1);
    const runs = await env.admin.query<{ status: string; error_message: string | null }>(
      'select status, error_message from public.processing_run where capture_id = $1 order by started_at', [captureId],
    );
    expect(runs.rows.map((r) => r.status)).toEqual(['failed', 'succeeded']);
    expect(runs.rows[0]?.error_message).toMatch(/Waktu pemrosesan habis/);
    expect((await captureRow(env, captureId)).status).toMatch(/done|needs_confirmation/);
  });
});

describe('LISTEN/NOTIFY', () => {
  it('worker yang berjalan memproses unggahan baru tanpa menunggu polling', async () => {
    const w = new Worker({ ...env.deps, workerId: 'w-listen', pollMs: 60_000 });
    await w.start();
    try {
      const { captureId } = await submitFixture(env, 'label-milo');
      const deadline = Date.now() + 10_000;
      let status = 'uploaded';
      while (Date.now() < deadline && ['uploaded', 'processing'].includes(status)) {
        await new Promise((r) => setTimeout(r, 100));
        status = (await captureRow(env, captureId)).status;
      }
      expect(status).toBe('needs_confirmation');
    } finally {
      await w.stop();
    }
  });
});

describe('--dev-scheduler', () => {
  it('menjalankan fungsi SQL yang sama dengan pg_cron (sebagai service_role)', async () => {
    const s = new Scheduler(sqlTasks(env.workerDb), () => new Date('2026-10-19T17:40:00Z'));
    const ran = await s.tick();
    expect(ran.sort()).toEqual(['alias-promote', 'reap-stale-runs', 'retention', 'sql-jobs', 'summary-queue', 'summary-time']);
    const q = await env.admin.query('select count(*)::int as n from app.summary_refresh_queue');
    expect(q.rows[0].n).toBe(0);
  });
});
