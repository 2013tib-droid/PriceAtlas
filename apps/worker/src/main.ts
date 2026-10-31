// Titik masuk worker.
//   tsx src/main.ts [--dev-scheduler] [--once [--sweep]] [--worker-id <id>]   (src/cli.ts)
// Env: DATABASE_URL, WORKER_DB_ROLE, WORKER_DB_ROLE_MODE (startup | set; src/db.ts),
//      WORKER_EXPECT_ROLE (opsional: role efektif wajib, mis. service_role di produksi; docs/09 §6.3),
//      STORAGE_BACKEND (supabase|local), LOCAL_STORAGE_DIR,
//      NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (backend supabase),
//      EXTRACTOR (stub | vision | ocr+parse | off), AI_MATCHER (stub | claude | off), WORKER_ANTHROPIC_API_KEY,
//      EXTRACT_MODEL, EXTRACT_EFFORT_RECEIPT, EXTRACT_EFFORT_OBSERVATION, OCR_ENGINE, GOOGLE_VISION_API_KEY
//      (docs/08 §5.1; lihat src/extractors/select.ts), STUB_FIXTURES_DIR,
//      STUB_FALLBACK_FIXTURE (khusus worker e2e: nama fixture untuk gambar tak dikenal, Q-82/Q-118),
//      CAPTURE_LEASE_SECONDS (default 300, ≤ capture_processing_timeout_seconds; docs/08 §5.4),
//      AI_DAILY_BUDGET_USD (override app.config ai_daily_budget_usd; docs/08 §12.3).
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { LocalBlobStore } from './adapters/local-blob-store.ts';
import { SupabaseBlobStore } from './adapters/supabase-blob-store.ts';
import { parseWorkerArgs } from './cli.ts';
import { checkDbRole, createPool, parseRoleMode } from './db.ts';
import { defaultFactories, selectAi } from './extractors/select.ts';
import { log } from './log.ts';
import { BudgetGate, DEFAULT_LEASE_SECONDS, checkLeaseSeconds, parsePositiveEnv } from './pipeline/process-capture.ts';
import type { BlobStore } from './pipeline/types.ts';
import { Worker } from './worker.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURES_DIR = resolve(HERE, '../test/fixtures');

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} wajib diisi (lihat .env.example)`);
  return v;
}

export function buildDeps(args: { workerId: string }) {
  const db = createPool(required('DATABASE_URL'), {
    role: process.env.WORKER_DB_ROLE || null,
    roleMode: parseRoleMode(process.env.WORKER_DB_ROLE_MODE),
  });

  let blob: BlobStore;
  const backend = process.env.STORAGE_BACKEND ?? 'supabase';
  if (backend === 'local') {
    blob = new LocalBlobStore(resolve(process.env.LOCAL_STORAGE_DIR ?? './.data/storage'), db);
  } else if (backend === 'supabase') {
    const sb = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    blob = new SupabaseBlobStore(sb);
  } else {
    throw new Error(`STORAGE_BACKEND tidak dikenal: ${backend}`);
  }

  const factories = defaultFactories(resolve(process.env.STUB_FIXTURES_DIR ?? DEFAULT_FIXTURES_DIR), process.env.STUB_FALLBACK_FIXTURE || undefined);
  const { extractor, ai, sources, verify, info } = selectAi(process.env, db, {
    ...factories,
    stub: () => {
      const s = factories.stub();
      if (s.fallback) log('worker.stub_fallback', { fixture: s.fallback.name, kind: s.fallback.output.kind });
      return s;
    },
  });
  log('worker.ai', { ...info, sources: sources?.join(',') ?? 'all' });
  const leaseSeconds = parsePositiveEnv('CAPTURE_LEASE_SECONDS', process.env.CAPTURE_LEASE_SECONDS, { integer: true }) ?? DEFAULT_LEASE_SECONDS;
  const budgetUsd = parsePositiveEnv('AI_DAILY_BUDGET_USD', process.env.AI_DAILY_BUDGET_USD);
  return {
    db,
    blob,
    extractor,
    ai,
    sources,
    workerId: args.workerId,
    leaseSeconds,
    budget: new BudgetGate(db, budgetUsd),
    verifyAi: verify,
  };
}

async function main(): Promise<void> {
  // Argumen diperiksa sebelum koneksi apa pun (argumen salah → keluar 1 tanpa menyentuh database).
  const args = parseWorkerArgs(process.argv.slice(2));
  const workerId = args.workerId ?? `${hostname()}-${process.pid}`;
  const deps = buildDeps({ workerId });
  const role = await checkDbRole(deps.db, process.env.WORKER_EXPECT_ROLE || process.env.WORKER_DB_ROLE || null);
  log('worker.db', { role });
  await checkLeaseSeconds(deps.db, deps.leaseSeconds);
  await deps.verifyAi();
  const worker = new Worker({ ...deps, devScheduler: args.devScheduler });

  if (args.once) {
    const { processed, swept } = await worker.runOnce({ sweep: args.sweep });
    log('worker.once', { processed, swept });
    await deps.db.end();
    return;
  }

  await worker.start();
  const shutdown = async () => {
    await worker.stop();
    await deps.db.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    log('worker.fatal', { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  });
}
