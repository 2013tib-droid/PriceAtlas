// Kesetaraan kontrak TypeScript dengan SQL (docs/05 §3.3 S-03b, §8.1 L2).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { newPool } from '@priceatlas/testkit';
import { ASK_RPC_INPUTS, ERROR_HTTP, RPC_INPUTS, RPC_NAMES, UNITS, isValidPriceExtra, unitPrice, type UnitPriceProduct } from '../src/index.ts';
import { EXTRA_CASES } from './extra-cases.ts';

let pool: pg.Pool;
beforeAll(() => {
  pool = newPool(process.env.CONTRACTS_DB_URL!);
});
afterAll(async () => {
  await pool.end();
});

describe('unitPrice = trigger app.compute_unit_price', () => {
  it('produk acak: hasil TS sama dengan kolom price_record.unit_price', async () => {
    const units = Object.keys(UNITS);
    const cases: { product: UnitPriceProduct; price: number }[] = [];
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 60; i++) {
      const weight = i % 5 === 0;
      cases.push({
        product: {
          sale_mode: weight ? 'weight' : 'unit',
          pack_count: weight ? 1 : 1 + Math.floor(rnd() * 12),
          content_size: weight ? null : Math.round((0.5 + rnd() * 2000) * 1000) / 1000,
          content_unit: units[Math.floor(rnd() * units.length)]!,
        },
        price: Math.round(rnd() * 500000 * 100) / 100,
      });
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const hh = (await client.query<{ id: string }>('select id from public.household limit 1')).rows[0]!.id;
      for (const [i, c] of cases.entries()) {
        const pid = `eeeeeeee-0000-0000-0000-${String(i).padStart(12, '0')}`;
        await client.query(
          `insert into public.product (id, name, sale_mode, pack_count, content_size, content_unit) values ($1, $2, $3, $4, $5, $6)`,
          [pid, `uji ${i}`, c.product.sale_mode, c.product.pack_count, c.product.content_size, c.product.content_unit],
        );
        const r = await client.query<{ unit_price: string; via_fn: string }>(
          `insert into public.price_record (household_id, product_id, store_id, source_type, transaction_date, effective_price, price_basis)
           values ($1, $2, '20000000-0000-0000-0000-000000000001', 'price_label', current_date, $3, 'normal')
           returning unit_price, round(app.unit_price_for(product_id, effective_price), 6) as via_fn`,
          [hh, pid, c.price],
        );
        expect(Number(r.rows[0]!.unit_price), `kasus ${i}`).toBe(unitPrice(c.product, c.price));
        expect(Number(r.rows[0]!.via_fn), `kasus ${i} (unit_price_for)`).toBe(unitPrice(c.product, c.price));
      }
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('tabel satuan TS = public.unit', async () => {
    const r = await pool.query<{ code: string; dimension: string; f: string }>('select code, dimension, to_base_factor::text as f from public.unit');
    expect(r.rows.length).toBe(Object.keys(UNITS).length);
    for (const u of r.rows) {
      const ts = UNITS[u.code as keyof typeof UNITS];
      expect(ts, u.code).toBeDefined();
      expect(ts.dimension).toBe(u.dimension);
      expect(ts.toBaseFactor).toBe(Number(u.f));
    }
  });
});

describe('kontrak extra TS = app.valid_price_extra', () => {
  it.each(EXTRA_CASES)('$label', async ({ value, valid }) => {
    const r = await pool.query<{ ok: boolean }>('select app.valid_price_extra($1::jsonb) as ok', [JSON.stringify(value)]);
    expect(r.rows[0]!.ok).toBe(valid);
    expect(isValidPriceExtra(value)).toBe(valid);
  });
});

describe('kode error TS = app.err', () => {
  it('setiap kode menghasilkan SQLSTATE PT<http>', async () => {
    for (const [code, http] of Object.entries(ERROR_HTTP)) {
      const err = await pool.query('select app.err($1)', [code]).then(
        () => null,
        (e: pg.DatabaseError) => e,
      );
      expect(err?.code, code).toBe(`PT${http}`);
      expect(err?.message).toBe(code);
      expect(err?.hint, `${code} punya pesan Indonesia`).toBeTruthy();
    }
  });
  it('tidak ada kode SQL yang belum ada di TS', async () => {
    const r = await pool.query<{ def: string }>(`select pg_get_functiondef('app.err(text, jsonb)'::regprocedure) as def`);
    const sqlCodes = [...r.rows[0]!.def.matchAll(/\('([A-Z_]+)',\s+'\d{3}'/g)].map((m) => m[1]);
    expect(sqlCodes.sort()).toEqual(Object.keys(ERROR_HTTP).sort());
  });
});

describe('daftar RPC kontrak = fungsi di schema public', () => {
  it('sama persis', async () => {
    const r = await pool.query<{ proname: string }>(
      `select proname from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f' order by 1`,
    );
    const contract = [...RPC_NAMES.read, ...RPC_NAMES.write, ...RPC_NAMES.serviceRole, ...RPC_NAMES.askRoute].sort();
    expect(r.rows.map((x) => x.proname)).toEqual(contract);
  });
});

describe('RPC_INPUTS = argumen fungsi SQL', () => {
  it('kunci = RPC_NAMES.read + write', () => {
    expect(Object.keys(RPC_INPUTS).sort()).toEqual([...RPC_NAMES.read, ...RPC_NAMES.write].sort());
  });
  it('ASK_RPC_INPUTS = RPC_NAMES.askRoute', () => {
    expect(Object.keys(ASK_RPC_INPUTS).sort()).toEqual([...RPC_NAMES.askRoute].sort());
  });
  it('setiap field input ada sebagai argumen fungsi, dan argumen wajib ada di skema', async () => {
    const r = await pool.query<{ proname: string; args: string[] | null; nreq: number }>(
      `select proname, proargnames as args, pronargs - pronargdefaults as nreq
         from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f'`,
    );
    for (const row of r.rows) {
      const schema = ({ ...RPC_INPUTS, ...ASK_RPC_INPUTS } as Record<string, { shape?: Record<string, unknown> } | undefined>)[row.proname];
      if (!schema) continue;
      // where_cheaper memakai .refine(): bentuknya ada di schema dalam (ZodPipe/innerType).
      const shape = schema.shape ?? (schema as unknown as { def: { in?: { shape: Record<string, unknown> } } }).def.in?.shape;
      const keys = Object.keys(shape ?? {}).sort();
      const args = row.args ?? [];
      expect({ fn: row.proname, extra: keys.filter((k) => !args.includes(k)) }).toEqual({ fn: row.proname, extra: [] });
      expect({ fn: row.proname, missing: args.slice(0, row.nreq).filter((a) => !keys.includes(a)) })
        .toEqual({ fn: row.proname, missing: [] });
    }
  });
});
