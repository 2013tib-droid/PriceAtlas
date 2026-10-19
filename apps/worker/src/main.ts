// Titik masuk worker.
//   tsx src/main.ts [--dev-scheduler] [--once] [--worker-id <id>]
// Env: DATABASE_URL, WORKER_DB_ROLE, STORAGE_BACKEND (supabase|local), LOCAL_STORAGE_DIR,
//      NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (backend supabase),
//      EXTRACTOR (Tahap 4: hanya "stub"), STUB_FIXTURES_DIR.
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { LocalBlobStore } from './adapters/local-blob-store.ts';
import { SupabaseBlobStore } from './adapters/supabase-blob-store.ts';
import { createPool } from './db.ts';
import { FixtureRegistry, StubAiMatcher, StubExtractor } from './extractors/stub.ts';
import { log } from './log.ts';
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
  const db = createPool(required('DATABASE_URL'), { role: process.env.WORKER_DB_ROLE || null });

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

  const extractorKind = process.env.EXTRACTOR ?? 'stub';
  if (extractorKind !== 'stub') {
    throw new Error(`EXTRACTOR=${extractorKind} belum tersedia di Tahap 4 (D-16, Tahap 6). Pakai EXTRACTOR=stub.`);
  }
  const fixtures = new FixtureRegistry(resolve(process.env.STUB_FIXTURES_DIR ?? DEFAULT_FIXTURES_DIR));
  return { db, blob, extractor: new StubExtractor(fixtures), ai: new StubAiMatcher(fixtures), workerId: args.workerId };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (f: string) => argv.includes(f);
  const idIdx = argv.indexOf('--worker-id');
  const workerId = idIdx >= 0 ? argv[idIdx + 1]! : `${hostname()}-${process.pid}`;
  const deps = buildDeps({ workerId });
  const worker = new Worker({ ...deps, devScheduler: flag('--dev-scheduler') });

  if (flag('--once')) {
    const n = await worker.drainOnce();
    log('worker.once', { processed: n });
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
