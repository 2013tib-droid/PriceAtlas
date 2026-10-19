// Tools AI terhadap data seed dengan JWT simulasi (docs/05 §6, §8.1 L3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { RPC_NAMES, type RpcClient } from '@priceatlas/contracts';
import { PgRpcClient, USERS, buildTestDb, householdOf, newPool } from '@priceatlas/testkit';
import { TOOL_RPCS, registry, runTool } from '../src/index.ts';

let pool: pg.Pool;
let ani: PgRpcClient;
let budi: PgRpcClient;
const calls: string[] = [];
const spy = (c: RpcClient): RpcClient => ({ rpc: (fn, args) => (calls.push(fn), c.rpc(fn, args)) });

beforeAll(async () => {
  pool = newPool(buildTestDb('priceatlas_l3_tools'));
  ani = new PgRpcClient(pool, USERS.a);
  budi = new PgRpcClient(pool, USERS.b);
  const a = await householdOf(pool, USERS.a);
  const b = await householdOf(pool, USERS.b);
  await pool.query(
    `insert into public.price_record (household_id, product_id, store_id, branch_id, source_type, transaction_date,
                                      normal_price, promo_price, effective_price, price_basis, is_bundle)
     select hh::uuid, p::uuid, s::uuid, br::uuid, 'price_label', current_date - d, n, pr, e, basis, bun
       from (values
         ($1, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 3,  19500, null::numeric, 19500, 'normal', false),
         ($1, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000002', null,                                   10, 19500, 18000, 18000, 'promo', false),
         ($1, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 40, 21000, null, 21000, 'normal', false),
         ($1, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 45, 21000, null, 21000, 'normal', false),
         ($1, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 20, 20000, null, 20000, 'normal', false),
         ($1, '70000000-0000-0000-0000-000000000500', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 5,  47500, null, 47500, 'normal', false),
         ($1, '70000000-0000-0000-0000-000000000180', '20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000005', 2,  6000,  null, 6000,  'normal', false),
         ($2, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004', 1,  9999,  null, 9999,  'normal', false))
       v(hh, p, s, br, d, n, pr, e, basis, bun)`,
    [a, b],
  );
  await pool.query('select app.process_summary_queue()');
});
afterAll(async () => {
  await pool.end();
});

describe('registry', () => {
  it('6 tool sesuai §6, dengan JSON Schema input', () => {
    expect(registry.map((t) => t.name)).toEqual([
      'cari_harga_terbaik', 'tren_harga', 'harga_per_satuan', 'bandingkan_ukuran', 'lebih_hemat_di_mana', 'histori_harga',
    ]);
    for (const t of registry) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.description.length).toBeGreaterThan(40);
    }
    const kw = (registry[0]!.inputSchema.properties as Record<string, { maxLength?: number }>).kata_kunci;
    expect(kw?.maxLength).toBe(100);
  });
  it('D-57: tools hanya memakai RPC baca', () => {
    for (const fn of TOOL_RPCS) expect(RPC_NAMES.read).toContain(fn);
  });
});

describe('validasi input (zod)', () => {
  it.each([
    ['cari_harga_terbaik', {}],
    ['cari_harga_terbaik', { kata_kunci: 'milo', produk_id: '70000000-0000-0000-0000-000000000200' }],
    ['cari_harga_terbaik', { kata_kunci: 'x'.repeat(101) }],
    ['cari_harga_terbaik', { kata_kunci: 'milo', batas: 11 }],
    ['tren_harga', { produk_id: "'; drop table price_record; --" }],
    ['histori_harga', { produk_id: '70000000-0000-0000-0000-000000000200', sql: 'select 1' }],
    ['lebih_hemat_di_mana', { produk_id: '70000000-0000-0000-0000-000000000200', jendela_hari: 7 }],
  ])('%s %j → INVALID_INPUT', async (name, input) => {
    expect(await runTool(ani, name, input)).toMatchObject({ ok: false, error: { kode: 'INVALID_INPUT' } });
  });
  it('tool tidak dikenal', async () => {
    expect(await runTool(ani, 'tulis_harga', {})).toMatchObject({ ok: false, error: { kode: 'UNKNOWN_TOOL' } });
  });
});

describe('output per tool (household Ani)', () => {
  it('cari_harga_terbaik: 90 hari promo vs sepanjang masa, toko, cabang tidak diketahui', async () => {
    const r = await runTool(spy(ani), 'cari_harga_terbaik', { kata_kunci: 'milo original' });
    expect(r.ok).toBe(true);
    const out = (r as { output: Record<string, unknown>[] }).output;
    const milo200 = out.find((x) => (x.produk as { id: string }).id === '70000000-0000-0000-0000-000000000200')!;
    expect(milo200).toMatchObject({
      produk: { nama: 'Milo Original', ukuran: '200 g' },
      terbaik_90_hari: { harga: 18000, label: 'promo', per_satuan: 90, satuan: 'g', toko: 'Alfamart', cabang: 'cabang tidak diketahui' },
      jumlah_data: 5,
      layar: { id: 'S-03', produk_id: '70000000-0000-0000-0000-000000000200' },
    });
    expect(out.length).toBeGreaterThan(1);                 // > 1 hasil → AI bertanya "maksudmu …"
  });
  it('cari_harga_terbaik dengan produk_id', async () => {
    const r = await runTool(ani, 'cari_harga_terbaik', { produk_id: '70000000-0000-0000-0000-000000000500' });
    expect((r as { output: unknown[] }).output).toHaveLength(1);
  });
  it('tren_harga: D-54, label tetap', async () => {
    const r = await runTool(ani, 'tren_harga', { produk_id: '70000000-0000-0000-0000-000000000200' });
    expect(r).toMatchObject({
      ok: true,
      output: { arah: 'turun', data_jendela_ini: 3, data_jendela_sebelumnya: 2, minimal_data_per_jendela: 2, label: 'vs 30 hari sebelumnya', jumlah_data: 5 },
    });
  });
  it('tren_harga data kurang → arah null', async () => {
    const r = await runTool(ani, 'tren_harga', { produk_id: '70000000-0000-0000-0000-000000000500' });
    expect(r).toMatchObject({ ok: true, output: { arah: null, jumlah_data: 1 } });
  });
  it('harga_per_satuan dengan harga rak (D-55, tanpa menyimpan)', async () => {
    const before = (await pool.query('select count(*)::int as n from public.price_record')).rows[0].n;
    const r = await runTool(ani, 'harga_per_satuan', { produk_id: '70000000-0000-0000-0000-000000000200', harga_rak: 18500 });
    expect(r).toMatchObject({
      ok: true,
      output: { satuan_dasar: 'g', terbaik_90_hari_per_satuan: 90, harga_rak_per_satuan: 92.5, selisih_persen_vs_terbaik: 2.8, mendekati_terbaik: true, layar: { id: 'S-03b' } },
    });
    expect((await pool.query('select count(*)::int as n from public.price_record')).rows[0].n).toBe(before);
  });
  it('bandingkan_ukuran: per dimensi, tanpa data dipisah', async () => {
    const r = await runTool(ani, 'bandingkan_ukuran', { produk_id: '70000000-0000-0000-0000-000000000200' });
    const out = (r as { output: { group: { nama: string }; per_dimensi: { dimensi: string; baris: { peringkat: number }[]; tanpa_data: unknown[] }[] } }).output;
    expect(out.group.nama).toBe('Milo Original');
    const mass = out.per_dimensi.find((d) => d.dimensi === 'mass')!;
    expect(mass.baris.map((b) => b.peringkat)).toEqual([1, 2]);
    expect(mass.tanpa_data).toHaveLength(1);
    expect(out.per_dimensi.find((d) => d.dimensi === 'volume')?.baris).toHaveLength(1);
  });
  it('lebih_hemat_di_mana: catatan online dan 1 data', async () => {
    const r = await runTool(ani, 'lebih_hemat_di_mana', { product_group_id: '60000000-0000-0000-0000-000000000001', jendela_hari: null });
    const out = (r as { output: { per_dimensi: { dimensi: string; toko: { toko: string; catatan?: string }[] }[] } }).output;
    const vol = out.per_dimensi.find((d) => d.dimensi === 'volume')!;
    expect(vol.toko[0]).toMatchObject({ toko: 'Shopee', catatan: 'harga belum termasuk ongkir; baru 1 data' });
  });
  it('histori_harga per toko', async () => {
    const r = await runTool(ani, 'histori_harga', { produk_id: '70000000-0000-0000-0000-000000000200', toko_id: '20000000-0000-0000-0000-000000000001', batas: 2 });
    expect(r).toMatchObject({ ok: true, output: { jumlah_data: 2, riwayat: [{ toko: 'AEON', cabang: 'AEON BSD' }, {}] } });
  });
  it('error RPC dikembalikan sebagai data', async () => {
    expect(await runTool(ani, 'tren_harga', { produk_id: '99999999-0000-0000-0000-000000000000' })).toMatchObject({
      ok: false, error: { kode: 'NOT_FOUND' },
    });
  });
  it('tool hanya memanggil RPC baca yang terdaftar', () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(TOOL_RPCS as readonly string[]).toContain(c);
  });
});

describe('isolasi household (RLS lewat JWT user)', () => {
  it('semua tool sebagai Budi tidak memuat data Ani', async () => {
    const inputs: [string, unknown][] = [
      ['cari_harga_terbaik', { kata_kunci: 'milo' }],
      ['tren_harga', { produk_id: '70000000-0000-0000-0000-000000000200' }],
      ['harga_per_satuan', { produk_id: '70000000-0000-0000-0000-000000000200', harga_rak: 10000 }],
      ['bandingkan_ukuran', { product_group_id: '60000000-0000-0000-0000-000000000001', jendela: 'all' }],
      ['lebih_hemat_di_mana', { produk_id: '70000000-0000-0000-0000-000000000200', jendela_hari: null }],
      ['histori_harga', { produk_id: '70000000-0000-0000-0000-000000000200' }],
    ];
    for (const [name, input] of inputs) {
      const r = await runTool(budi, name, input);
      expect(r.ok, name).toBe(true);
      const text = JSON.stringify(r);
      expect(text, name).not.toMatch(/19500|18000|AEON BSD|Shopee/);
    }
    const h = await runTool(budi, 'histori_harga', { produk_id: '70000000-0000-0000-0000-000000000200' });
    expect(h).toMatchObject({ output: { jumlah_data: 1, riwayat: [{ harga_efektif: 9999, toko: 'Alfamidi' }] } });
  });
});
