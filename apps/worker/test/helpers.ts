import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type pg from 'pg';
import { PgRpcClient, USERS, buildTestDb, newPool } from '@priceatlas/testkit';
import { LocalBlobStore } from '../src/adapters/local-blob-store.ts';
import { createPool } from '../src/db.ts';
import { FixtureRegistry, StubAiMatcher, StubExtractor } from '../src/extractors/stub.ts';
import { setLogSink } from '../src/log.ts';
import type { PipelineDeps } from '../src/pipeline/process-capture.ts';
import { uploadAndSubmit } from '../scripts/client-sim.ts';

export const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures');
export const fixtures = new FixtureRegistry(FIXTURES_DIR);

export function fixtureImages(name: string): Buffer[] {
  const fx = fixtures.byName(name);
  if (!fx?.images) throw new Error(`fixture ${name}`);
  return fx.images.map((f) => readFileSync(join(FIXTURES_DIR, f)));
}

export interface Env {
  url: string;
  admin: pg.Pool;          // superuser: menyiapkan data dan memeriksa hasil
  workerDb: pg.Pool;       // worker: SET ROLE service_role (hak sama dengan Supabase)
  blob: LocalBlobStore;
  deps: PipelineDeps;
  ani: PgRpcClient;
  budi: PgRpcClient;
  close(): Promise<void>;
}

export const logs: string[] = [];
setLogSink((line) => logs.push(line));

export function setupEnv(dbName: string, workerId = 'w-test'): Env {
  const url = buildTestDb(dbName);
  const admin = newPool(url, 5);
  const workerDb = createPool(url, { role: 'service_role', max: 4 });
  const blob = new LocalBlobStore(mkdtempSync(join(tmpdir(), 'pa-blob-')), workerDb);
  const deps: PipelineDeps = {
    db: workerDb,
    blob,
    extractor: new StubExtractor(fixtures),
    ai: new StubAiMatcher(fixtures),
    workerId,
  };
  return {
    url, admin, workerDb, blob, deps,
    ani: new PgRpcClient(admin, USERS.a),
    budi: new PgRpcClient(admin, USERS.b),
    async close() {
      await workerDb.end();
      await admin.end();
    },
  };
}

export async function submitFixture(env: Env, name: string, opts: { user?: string; sessionId?: string; storeId?: string } = {}) {
  const fx = fixtures.byName(name)!;
  return uploadAndSubmit({
    pool: env.admin,
    blob: env.blob,
    userId: opts.user ?? USERS.a,
    kind: fx.output.kind,
    images: fixtureImages(name),
    sessionId: opts.sessionId ?? null,
    storeId: opts.storeId ?? null,
  });
}

export async function captureRow(env: Env, id: string) {
  const r = await env.admin.query('select * from public.capture where id = $1', [id]);
  return r.rows[0];
}

/** Lewati backoff retry (§5.3) tanpa menunggu: mundurkan waktu run terakhir. */
export async function skipBackoff(env: Env, captureId: string): Promise<void> {
  await env.admin.query(
    `update public.processing_run set started_at = started_at - interval '1 hour', finished_at = finished_at - interval '1 hour'
      where capture_id = $1`,
    [captureId],
  );
}
