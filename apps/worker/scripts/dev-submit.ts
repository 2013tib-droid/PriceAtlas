// Mode A: kirim fixture sebagai user, seolah dari aplikasi.
//   pnpm --filter @priceatlas/worker dev:submit <nama-fixture> [--user a|b|<uuid>] [--session <uuid>] [--store <uuid>]
// Env: DATABASE_URL (superuser lokal), LOCAL_STORAGE_DIR, STUB_FIXTURES_DIR (opsional).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { USERS } from '@priceatlas/testkit';
import { LocalBlobStore } from '../src/adapters/local-blob-store.ts';
import { FixtureRegistry } from '../src/extractors/stub.ts';
import { DEFAULT_FIXTURES_DIR } from '../src/main.ts';
import { uploadAndSubmit } from './client-sim.ts';

const argv = process.argv.slice(2);
const name = argv[0];
const opt = (f: string) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : undefined);
if (!name) {
  console.error('pakai: dev:submit <nama-fixture> [--user a] [--session <uuid>] [--store <uuid>]');
  process.exit(2);
}
const dir = resolve(process.env.STUB_FIXTURES_DIR ?? DEFAULT_FIXTURES_DIR);
const fx = new FixtureRegistry(dir).byName(name);
if (!fx?.images) {
  console.error(`fixture ${name} tidak ada (atau tanpa "images") di ${dir}`);
  process.exit(2);
}
const userArg = opt('--user') ?? 'a';
const userId = USERS[userArg as keyof typeof USERS] ?? userArg;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const blob = new LocalBlobStore(resolve(process.env.LOCAL_STORAGE_DIR ?? './.data/storage'), pool);
const kind = fx.output.kind;
const { captureId } = await uploadAndSubmit({
  pool,
  blob,
  userId,
  kind,
  images: fx.images.map((f) => readFileSync(join(dir, f))),
  sessionId: opt('--session') ?? null,
  storeId: opt('--store') ?? null,
});
console.log(JSON.stringify({ capture_id: captureId, fixture: name, kind, user: userId }));
await pool.end();
