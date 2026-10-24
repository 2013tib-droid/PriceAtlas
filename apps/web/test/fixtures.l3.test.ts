// Fixture L5b dari keluaran RPC asli (docs/07 §11.1, L3 mode A). Butuh PostgreSQL (PG* env), sama
// seperti test L2/L3 di packages/*. Menjaga dua hal:
//   1. Setiap keluaran RPC lolos skema kontrak (packages/contracts) yang dipakai hook web.
//   2. Bentuk test/fixtures/rpc.json (yang dipakai test komponen) sama dengan keluaran server saat ini.
// Membangkitkan ulang fixture: UPDATE_FIXTURES=1 pnpm --filter @priceatlas/web test fixtures
// Hanya menambah kunci baru (nilai yang di-commit tetap, mis. jam sesi yang dipakai test M4):
// UPDATE_FIXTURES=new …
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestDb, newPool } from '@priceatlas/testkit';
import { collectFixtures, type Fixtures } from './fixtures/scenario';
import { FIXTURE_SCHEMAS } from './fixtures/schemas';

const FILE = resolve(import.meta.dirname, 'fixtures/rpc.json');

let pool: pg.Pool;
let fresh: Fixtures;

beforeAll(async () => {
  const url = buildTestDb('priceatlas_l3_web_fixtures');
  pool = newPool(url);
  fresh = await collectFixtures(pool, url);
  if (process.env.UPDATE_FIXTURES === 'new') {
    const committed = JSON.parse(readFileSync(FILE, 'utf8')) as Fixtures;
    const data = { ...committed.data };
    for (const [k, v] of Object.entries(fresh.data)) if (!(k in data)) data[k] = v;
    writeFileSync(FILE, `${JSON.stringify({ today: committed.today, data }, null, 2)}\n`);
  } else if (process.env.UPDATE_FIXTURES) writeFileSync(FILE, `${JSON.stringify(fresh, null, 2)}\n`);
});
afterAll(async () => {
  await pool?.end();
});

/** Bentuk nilai: tipe daun + kunci objek + panjang array (data skenario deterministik). */
function shape(v: unknown): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) return { len: v.length, items: v.map(shape) };
  if (typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, shape((v as Record<string, unknown>)[k])]),
    );
  return typeof v;
}

describe('fixture RPC asli (L3 mode A)', () => {
  it('setiap keluaran punya skema dan lolos skema kontrak', () => {
    expect(Object.keys(fresh.data).sort()).toEqual(Object.keys(FIXTURE_SCHEMAS).sort());
    for (const [key, schema] of Object.entries(FIXTURE_SCHEMAS)) {
      const r = schema.safeParse(fresh.data[key]);
      expect(r.success ? null : { key, issues: r.error.issues }, key).toBeNull();
    }
  });

  it('bentuk rpc.json yang di-commit = keluaran server saat ini', () => {
    const committed = JSON.parse(readFileSync(FILE, 'utf8')) as Fixtures;
    for (const key of Object.keys(fresh.data)) {
      expect(shape(committed.data[key]), key).toEqual(shape(fresh.data[key]));
    }
  });
});
