// L3 Tahap 7b B2 (docs/09 §3.3, §12; F-185, F-186): argumen worker, `--once --sweep`, dan cadangan
// SET ROLE (WORKER_DB_ROLE_MODE=set) untuk pooler produksi.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS, householdOf } from '@priceatlas/testkit';
import { parseWorkerArgs } from '../src/cli.ts';
import { checkDbRole, createPool, parseRoleMode } from '../src/db.ts';
import { Worker } from '../src/worker.ts';
import { setupEnv, type Env } from './helpers.ts';

const TSX = resolve(import.meta.dirname, '../node_modules/.bin/tsx');
const MAIN = resolve(import.meta.dirname, '../src/main.ts');

describe('parseWorkerArgs', () => {
  it.each([
    [[], { once: false, sweep: false, devScheduler: false, workerId: null }],
    [['--once'], { once: true, sweep: false }],
    [['--once', '--sweep'], { once: true, sweep: true }],
    [['--sweep', '--once', '--worker-id', 'gh-1'], { once: true, sweep: true, workerId: 'gh-1' }],
    [['--dev-scheduler'], { devScheduler: true }],
  ])('%j diterima', (argv, want) => {
    expect(parseWorkerArgs(argv)).toMatchObject(want);
  });

  it.each([
    [['--sweep'], /hanya bersama --once/],
    [['--dev-scheduler', '--sweep'], /hanya bersama --once/],
    [['--once', '--dev-scheduler'], /tidak bisa bersama --once/],
    [['--once', '--swep'], /tidak dikenal: --swep/],
    [['once'], /tidak dikenal: once/],
    [['--once', '--once'], /ganda/],
    [['--worker-id'], /butuh nilai/],
    [['--worker-id', '--once'], /butuh nilai/],
  ])('%j ditolak', (argv, msg) => {
    expect(() => parseWorkerArgs(argv)).toThrow(msg);
  });
});

describe('parseRoleMode', () => {
  it('default startup; set; selain itu ditolak', () => {
    expect(parseRoleMode(undefined)).toBe('startup');
    expect(parseRoleMode('')).toBe('startup');
    expect(parseRoleMode('startup')).toBe('startup');
    expect(parseRoleMode(' set ')).toBe('set');
    expect(() => parseRoleMode('SET ROLE')).toThrow(/WORKER_DB_ROLE_MODE/);
  });
});

let env: Env;
beforeAll(() => {
  env = setupEnv('priceatlas_l3_once');
});
afterAll(async () => {
  await env.close();
});

describe('role worker (F-186 cadangan SET ROLE)', () => {
  it('mode set: setiap koneksi baru menjadi service_role', async () => {
    const db = createPool(env.url, { role: 'service_role', roleMode: 'set', max: 2 });
    try {
      // Dua koneksi paralel: keduanya harus sudah berganti role sebelum query pemanggil.
      const [a, b] = await Promise.all([db.connect(), db.connect()]);
      const ra = await a.query('select current_user, session_user');
      const rb = await b.query('select current_user');
      a.release();
      b.release();
      expect(ra.rows[0]).toEqual({ current_user: 'service_role', session_user: 'postgres' });
      expect(rb.rows[0].current_user).toBe('service_role');
      expect(await checkDbRole(db, 'service_role')).toBe('service_role');
    } finally {
      await db.end();
    }
  });

  it('mode set dengan role yang tidak bisa dipakai → query gagal, tidak berjalan sebagai role login', async () => {
    const db = createPool(env.url, { role: 'role_tidak_ada', roleMode: 'set', max: 1 });
    db.on('error', () => undefined);
    try {
      await expect(db.query('select current_user')).rejects.toThrow();
    } finally {
      await db.end().catch(() => undefined);
    }
  });

  it('checkDbRole: role efektif berbeda → error', async () => {
    const db = createPool(env.url, { max: 1 });
    try {
      await expect(checkDbRole(db, 'service_role')).rejects.toThrow(/role database worker postgres, seharusnya service_role/);
      expect(await checkDbRole(db, null)).toBe('postgres');
    } finally {
      await db.end();
    }
  });
});

async function orphan(name: string, ageHours: number): Promise<string> {
  const hh = await householdOf(env.admin, USERS.b);
  const path = `${hh}/${name}/1.jpg`;
  await env.blob.put(path, Buffer.from('x'));
  await env.budi.asUser(`insert into storage.objects (bucket_id, name) values ('captures', $1)`, [path]);
  await env.admin.query(`update storage.objects set created_at = now() - make_interval(hours => $2) where name = $1`, [path, ageHours]);
  return path;
}
const fileOf = (path: string) => join(env.blob.rootDir, 'captures', path);

describe('Worker.runOnce (F-185)', () => {
  it('tanpa sweep: objek yatim dibiarkan; dengan sweep: objek yatim > 24 jam dihapus', async () => {
    const old = await orphan('bbbbbbbb-0000-4000-8000-000000000001', 25);
    const fresh = await orphan('bbbbbbbb-0000-4000-8000-000000000002', 1);
    const w = new Worker(env.deps);
    expect(await w.runOnce()).toEqual({ processed: 0, swept: null });
    expect(existsSync(fileOf(old))).toBe(true);
    expect(await w.runOnce({ sweep: true })).toEqual({ processed: 0, swept: 1 });
    expect(existsSync(fileOf(old))).toBe(false);
    expect(existsSync(fileOf(fresh))).toBe(true);
  });
});

function runMain(args: string[], extraEnv: Record<string, string | undefined>) {
  const base = { ...process.env };
  for (const k of ['DATABASE_URL', 'WORKER_DB_ROLE', 'WORKER_DB_ROLE_MODE', 'WORKER_EXPECT_ROLE', 'EXTRACTOR', 'AI_MATCHER']) delete base[k];
  const child = spawnSync(TSX, [MAIN, ...args], { env: { ...base, ...extraEnv }, encoding: 'utf8', timeout: 60_000 });
  const events = child.stdout
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { status: child.status, events };
}

describe('main.ts sebagai proses (seperti worker.yml)', () => {
  it('--sweep tanpa --once → keluar 1 sebelum menyentuh database (tanpa DATABASE_URL pun)', () => {
    const r = runMain(['--sweep'], {});
    expect(r.status).toBe(1);
    expect(r.events).toEqual([expect.objectContaining({ event: 'worker.fatal', error: '--sweep hanya bersama --once' })]);
  });

  it('argumen tidak dikenal → keluar 1', () => {
    const r = runMain(['--once', '--swep'], {});
    expect(r.status).toBe(1);
    expect(r.events[0]).toMatchObject({ event: 'worker.fatal', error: 'argumen tidak dikenal: --swep' });
  });

  it('WORKER_EXPECT_ROLE tidak cocok → keluar 1 (mis. URL produksi memakai postgres)', () => {
    const r = runMain(['--once'], {
      DATABASE_URL: env.url,
      STORAGE_BACKEND: 'local',
      LOCAL_STORAGE_DIR: env.blob.rootDir,
      EXTRACTOR: 'off',
      AI_MATCHER: 'off',
      WORKER_EXPECT_ROLE: 'service_role',
    });
    expect(r.status).toBe(1);
    expect(r.events.at(-1)).toMatchObject({ event: 'worker.fatal', error: 'role database worker postgres, seharusnya service_role' });
    expect(r.events.some((e) => e.event === 'worker.once')).toBe(false);
  });

  it('--once --sweep dengan SET ROLE + EXTRACTOR=off: antrean dikuras, sapuan jalan, keluar 0', async () => {
    const old = await orphan('bbbbbbbb-0000-4000-8000-000000000003', 30);
    const r = runMain(['--once', '--sweep', '--worker-id', 'gh-test'], {
      DATABASE_URL: env.url,
      WORKER_DB_ROLE: 'service_role',
      WORKER_DB_ROLE_MODE: 'set',
      WORKER_EXPECT_ROLE: 'service_role',
      STORAGE_BACKEND: 'local',
      LOCAL_STORAGE_DIR: env.blob.rootDir,
      EXTRACTOR: 'off',
      AI_MATCHER: 'off',
    });
    expect(r.status).toBe(0);
    expect(r.events.find((e) => e.event === 'worker.db')).toMatchObject({ role: 'service_role' });
    expect(r.events.find((e) => e.event === 'worker.ai')).toMatchObject({ sources: 'text' });
    expect(r.events.find((e) => e.event === 'orphans.swept')).toMatchObject({ count: 1 });
    expect(r.events.at(-1)).toMatchObject({ event: 'worker.once', processed: 0, swept: 1 });
    expect(existsSync(fileOf(old))).toBe(false);
  });
});
