// Skenario data M1 untuk fixture L5b (docs/07 §11.1): keluaran RPC ASLI dari database mode A
// (migration + seed + record di bawah), dipanggil sebagai user lewat PgRpcClient (JWT simulasi).
// Dipakai test/fixtures.l3.test.ts: membangkitkan ulang `rpc.json` (UPDATE_FIXTURES=1) atau
// memeriksa bahwa bentuk keluaran server sama dengan fixture yang di-commit.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type pg from 'pg';
import { PgRpcClient, USERS, householdOf } from '@priceatlas/testkit';
import { uploadAndSubmit } from '@priceatlas/worker/scripts/client-sim.ts';
import { LocalBlobStore } from '@priceatlas/worker/src/adapters/local-blob-store.ts';
import { createPool } from '@priceatlas/worker/src/db.ts';
import { FixtureRegistry, StubAiMatcher, StubExtractor } from '@priceatlas/worker/src/extractors/stub.ts';
import { setLogSink } from '@priceatlas/worker/src/log.ts';
import { DEFAULT_FIXTURES_DIR } from '@priceatlas/worker/src/main.ts';
import { processNextCapture } from '@priceatlas/worker/src/pipeline/process-capture.ts';

export const IDS = {
  milo200: '70000000-0000-0000-0000-000000000200',
  milo500: '70000000-0000-0000-0000-000000000500',
  milo3in1: '70000000-0000-0000-0000-000000000310',
  miloUht: '70000000-0000-0000-0000-000000000180',
  indomie: '70000000-0000-0000-0000-000000000085',
  jeruk: '70000000-0000-0000-0000-0000000000f1',
  /** Global, tanpa histori (S-02 "produk ada, histori kosong"). */
  milo1kg: '70000000-0000-0000-0000-000000001000',
  /** Privat milik Ani, dengan 1 data. */
  gula: 'a0000000-0000-0000-0000-000000000001',
  /** Privat milik Ani, digabung ke Milo 200 g (redirect_to, via_merge). */
  miloDup: 'a0000000-0000-0000-0000-000000000002',
  groupMilo: '60000000-0000-0000-0000-000000000001',
  aeon: '20000000-0000-0000-0000-000000000001',
  alfamart: '20000000-0000-0000-0000-000000000002',
  alfamidi: '20000000-0000-0000-0000-000000000003',
  shopee: '20000000-0000-0000-0000-000000000004',
  aeonBsd: '30000000-0000-0000-0000-000000000001',
  alfaSerpong: '30000000-0000-0000-0000-000000000002',
  aeonLama: '30000000-0000-0000-0000-000000000003',
  midiCiputat: '30000000-0000-0000-0000-000000000004',
  nestleSeller: '30000000-0000-0000-0000-000000000005',
  aeonMember: '40000000-0000-0000-0000-000000000001',
  unknown: '99999999-0000-0000-0000-000000000000',
} as const;

async function seedScenario(pool: pg.Pool): Promise<void> {
  const a = await householdOf(pool, USERS.a);
  await pool.query(
    `insert into public.product (id, product_group_id, brand_id, category_id, name, variant, content_size, content_unit)
     select $1, $2, '50000000-0000-0000-0000-000000000001', c.id, 'Milo Original', '1 kg', 1, 'kg'
       from public.category c where c.slug = 'minuman'`,
    [IDS.milo1kg, IDS.groupMilo],
  );
  await pool.query(
    `insert into public.product (id, household_id, product_group_id, category_id, name, variant, content_size, content_unit)
     select v.id::uuid, $1, v.grp::uuid, c.id, v.name, null, v.size, v.unit
       from (values ($2, null, 'Gula Pasir Curah', 1::numeric, 'kg', 'makanan'),
                    ($3, $4, 'Milo 200 gr', 200, 'g', 'minuman')) v(id, grp, name, size, unit, slug)
       join public.category c on c.slug = v.slug`,
    [a, IDS.gula, IDS.miloDup, IDS.groupMilo],
  );
  await pool.query(
    `insert into public.barcode_assignment (product_id, household_id, code, code_type, valid_from)
     values ($1, $2, '9990000000012', 'gtin', '2024-01-01')`,
    [IDS.miloDup, a],
  );
  // Hari relatif terhadap "hari ini" di zona household (d = berapa hari lalu).
  await pool.query(
    `insert into public.price_record (household_id, product_id, store_id, branch_id, source_type, transaction_date,
                                      normal_price, promo_price, promo_min_qty, member_price, member_program_id,
                                      effective_price, price_basis, is_bundle, status, actual_weight, extra)
     select $1::uuid, p::uuid, s::uuid, br::uuid, src, app.household_today($1::uuid) - d, n, pr, pq, m, mp::uuid,
            e, basis, bun, st, w, x::jsonb
       from (values
         -- Milo 200 g: tren turun (4 data di 30 hari terakhir, 2 di 30 hari sebelumnya).
         ($2, $10, $14, 'price_label', 3,  19500, null::numeric, null::int, null::numeric, null, 19500, 'normal', false, 'active', null::numeric, '{}'),
         ($2, $11, null, 'price_label', 10, 19500, 18000, null, null, null, 18000, 'promo', false, 'active', null, '{}'),
         ($2, $10, $14, 'price_label', 20, 20000, null, null, null, null, 20000, 'normal', false, 'active', null, '{}'),
         ($2, $10, $14, 'price_label', 40, 21000, null, null, null, null, 21000, 'normal', false, 'active', null, '{}'),
         ($2, $10, $14, 'price_label', 45, 21000, null, null, null, null, 21000, 'normal', false, 'active', null, '{}'),
         ($2, $10, $15, 'price_label', 60, 20500, null, null, null, null, 20500, 'normal', false, 'active', null, '{}'),
         ($2, $10, $14, 'price_label', 5,  21000, null, null, 17900, $18, 21000, 'normal', false, 'active', null, '{}'),
         ($2, $10, $14, 'price_label', 7,  35000, null, null, null, null, 35000, 'normal', true,  'active', null, '{}'),
         ($2, $10, $14, 'price_label', 8,  15000, null, null, null, null, 15000, 'normal', false, 'void',   null, '{}'),
         ($2, $11, $16, 'price_label', 15, 19900, 18500, 2, null, null, 18500, 'promo', false, 'active', null, '{}'),
         -- Milo 500 g: 1 data 90 hari (tren belum cukup), termurah sepanjang masa lebih lama.
         ($3, $10, $14, 'price_label', 5,   47500, null, null, null, null, 47500, 'normal', false, 'active', null, '{}'),
         ($3, $12, $17, 'price_label', 200, 45000, null, null, null, null, 45000, 'normal', false, 'active', null, '{}'),
         -- Milo 3in1: hanya data lama (best_90d null).
         ($4, $11, $16, 'price_label', 150, 32000, null, null, null, null, 32000, 'normal', false, 'active', null, '{}'),
         -- Milo UHT: marketplace (online, ongkir sebagai info).
         ($5, $13, $19, 'marketplace', 2, 6000, null, null, null, null, 6000, 'normal', false, 'active', null, '{"shipping_fee": 10000}'),
         -- Indomie: hanya bundle.
         ($6, $11, $16, 'price_label', 4, 15000, null, null, null, null, 15000, 'normal', true, 'active', null, '{}'),
         -- Jeruk Medan: produk timbang (harga per kg, berat aktual).
         ($7, $11, $16, 'price_label', 6, 45000, null, null, null, null, 45000, 'normal', false, 'active', 0.535, '{}'),
         -- Gula privat.
         ($8, $12, $17, 'price_label', 12, 16500, null, null, null, null, 16500, 'normal', false, 'active', null, '{}'),
         -- Milo 200 gr privat (digabung di bawah): record pindah ke Milo 200 g.
         ($9, $10, $14, 'price_label', 25, 20000, null, null, null, null, 20000, 'normal', false, 'active', null, '{}'))
       v(p, s, br, src, d, n, pr, pq, m, mp, e, basis, bun, st, w, x)`,
    [
      a,
      IDS.milo200,
      IDS.milo500,
      IDS.milo3in1,
      IDS.miloUht,
      IDS.indomie,
      IDS.jeruk,
      IDS.gula,
      IDS.miloDup,
      IDS.aeon,
      IDS.alfamart,
      IDS.alfamidi,
      IDS.shopee,
      IDS.aeonBsd,
      IDS.aeonLama,
      IDS.alfaSerpong,
      IDS.midiCiputat,
      IDS.aeonMember,
      IDS.nestleSeller,
    ],
  );
  const ani = new PgRpcClient(pool, USERS.a);
  const merged = await ani.rpc('merge_product', { p_from: IDS.miloDup, p_into: IDS.milo200 });
  if (merged.error) throw new Error(`merge_product: ${merged.error.message}`);
  await pool.query('select app.process_summary_queue()');
}

/** Fixture worker tambahan untuk web (struk tanpa toko + field ragu), di samping fixture worker. */
const WEB_WORKER_FIXTURES = resolve(import.meta.dirname, 'worker');

/** Pipeline worker ASLI (stub + fixture) untuk user Citra, mode A + LocalBlobStore. */
function createWorker(pool: pg.Pool, url: string) {
  setLogSink(() => undefined);
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-fxdir-'));
  for (const src of [DEFAULT_FIXTURES_DIR, WEB_WORKER_FIXTURES])
    for (const f of readdirSync(src)) copyFileSync(join(src, f), join(dir, f));
  const workerDb = createPool(url, { role: 'service_role', max: 2 });
  const blob = new LocalBlobStore(mkdtempSync(join(tmpdir(), 'pa-web-fx-')), workerDb);
  const fixtures = new FixtureRegistry(dir);
  const deps = {
    db: workerDb,
    blob,
    extractor: new StubExtractor(fixtures),
    ai: new StubAiMatcher(fixtures),
    workerId: 'w-web-fixtures',
  };
  type SubmitOpts = { userId?: string; sessionId?: string | null };
  const submit = async (name: string, o: SubmitOpts = {}) => {
    const fx = fixtures.byName(name)!;
    const images = fx.images!.map((f) => readFileSync(join(dir, f)));
    return (
      await uploadAndSubmit({
        pool,
        blob,
        userId: o.userId ?? USERS.c,
        kind: fx.output.kind,
        images,
        sessionId: o.sessionId,
      })
    ).captureId;
  };
  /** Gambar tanpa fixture (stub → gagal `unsupported`), mis. frame kamera label. */
  const submitBytes = async (image: Buffer, kind: 'price_label', o: SubmitOpts = {}) =>
    (await uploadAndSubmit({ pool, blob, userId: o.userId ?? USERS.c, kind, images: [image], sessionId: o.sessionId }))
      .captureId;
  return { deps, workerDb, submit, submitBytes, process: () => processNextCapture(deps), end: () => workerDb.end() };
}
type Worker = ReturnType<typeof createWorker>;

/**
 * M2 (S-08/S-09): capture milik Citra di setiap status lewat pipeline worker ASLI (stub + fixture
 * apps/worker/test/fixtures), supaya R13/R14 = keluaran server. Citra dipakai agar histori Ani/Budi
 * (fixture M1) tidak berubah.
 */
async function seedCaptures(pool: pg.Pool, w: Worker) {
  const skipBackoff = (id: string) =>
    pool.query(
      `update public.processing_run set started_at = started_at - interval '1 hour',
              finished_at = finished_at - interval '1 hour' where capture_id = $1`,
      [id],
    );
  const needs = await w.submit('struk-aeon');
  await w.process();
  const failed = await w.submit('struk-buram');
  await w.process();
  // 2× gagal sementara lalu sukses (retry otomatis, backoff dilewati) → done.
  const done = await w.submit('struk-alfamart-timeout');
  for (let i = 0; i < 3; i++) {
    await w.process();
    await skipBackoff(done);
  }
  // Diklaim worker tanpa selesai → processing.
  const processing = await w.submit('label-milo');
  await w.workerDb.query(`select * from app.claim_next_capture('w-web-fixtures', 'stub', null, 'stub-1')`);
  const uploaded = await w.submit('shopee-milo');
  return { needs, failed, done, processing, uploaded };
}

export type Fixtures = { today: string; data: Record<string, unknown> };

/** Bangun skenario lalu kumpulkan keluaran RPC (Ani = punya histori, Budi = kosong). */
export async function collectFixtures(pool: pg.Pool, url: string): Promise<Fixtures> {
  await seedScenario(pool);
  const w = createWorker(pool, url);
  try {
    return await collectAll(pool, w);
  } finally {
    await w.end();
  }
}

async function collectAll(pool: pg.Pool, w: Worker): Promise<Fixtures> {
  const caps = await seedCaptures(pool, w);
  const ani = new PgRpcClient(pool, USERS.a);
  const budi = new PgRpcClient(pool, USERS.b);
  const data: Record<string, unknown> = {};
  const call = async (key: string, client: PgRpcClient, fn: string, args: Record<string, unknown> = {}) => {
    const r = await client.rpc(fn, args);
    data[key] = r.error ? { error: r.error } : r.data;
  };

  await call('context', ani, 'get_my_context');
  await call('config', ani, 'get_client_config');
  await call('search_milo', ani, 'search_products', { p_query: 'milo' });
  await call('search_indomie', ani, 'search_products', { p_query: 'indomie' });
  await call('search_jeruk', ani, 'search_products', { p_query: 'jeruk' });
  await call('search_gula', ani, 'search_products', { p_query: 'gula' });
  await call('search_none', ani, 'search_products', { p_query: 'milo actv xyz' });
  await call('search_milo_empty', budi, 'search_products', { p_query: 'milo' });
  await call('cards_viewed', ani, 'get_product_cards', { p_ids: [IDS.miloUht, IDS.milo200, IDS.gula] });
  for (const [k, id] of [
    ['milo200', IDS.milo200],
    ['milo500', IDS.milo500],
    ['milo3in1', IDS.milo3in1],
    ['miloUht', IDS.miloUht],
    ['indomie', IDS.indomie],
    ['jeruk', IDS.jeruk],
    ['gula', IDS.gula],
    ['milo1kg', IDS.milo1kg],
    ['miloDup', IDS.miloDup],
    ['unknown', IDS.unknown],
  ] as const) {
    await call(`detail_${k}`, ani, 'get_product_detail', { p_product_id: id });
  }
  await call('chart_milo200', ani, 'price_chart', { p_product_id: IDS.milo200 });
  await call('chart_milo200_normal', ani, 'price_chart', { p_product_id: IDS.milo200, p_normal_only: true });
  await call('chart_jeruk', ani, 'price_chart', { p_product_id: IDS.jeruk });
  await call('history_milo200', ani, 'price_history', { p_product_id: IDS.milo200, p_limit: 5 });
  const first = data.history_milo200 as { transaction_date: string; id: string }[];
  const last = first[first.length - 1]!;
  await call('history_milo200_page2', ani, 'price_history', {
    p_product_id: IDS.milo200,
    p_limit: 5,
    p_before_date: last.transaction_date,
    p_before_id: last.id,
  });
  await call('history_milo200_void', ani, 'price_history', { p_product_id: IDS.milo200, p_include_void: true });
  await call('history_milo200_aeon', ani, 'price_history', { p_product_id: IDS.milo200, p_store_id: IDS.aeon });
  await call('history_jeruk', ani, 'price_history', { p_product_id: IDS.jeruk });
  await call('history_miloUht', ani, 'price_history', { p_product_id: IDS.miloUht });
  await call('sizes_milo_90d', ani, 'compare_sizes', { p_group_id: IDS.groupMilo, p_window: '90d' });
  await call('sizes_milo_all', ani, 'compare_sizes', { p_group_id: IDS.groupMilo, p_window: 'all' });
  await call('sizes_milo_empty', budi, 'compare_sizes', { p_group_id: IDS.groupMilo, p_window: '90d' });
  await call('sizes_unknown', ani, 'compare_sizes', { p_group_id: IDS.unknown, p_window: '90d' });
  await call('cheaper_milo200_90', ani, 'where_cheaper', { p_product_id: IDS.milo200, p_window_days: 90 });
  await call('cheaper_milo200_all', ani, 'where_cheaper', { p_product_id: IDS.milo200, p_window_days: null });
  await call('cheaper_group_90', ani, 'where_cheaper', { p_group_id: IDS.groupMilo, p_window_days: 90 });
  await call('cheaper_group_all', ani, 'where_cheaper', { p_group_id: IDS.groupMilo, p_window_days: null });
  await call('cheaper_milo3in1_90', ani, 'where_cheaper', { p_product_id: IDS.milo3in1, p_window_days: 90 });
  await call('cheaper_milo3in1_all', ani, 'where_cheaper', { p_product_id: IDS.milo3in1, p_window_days: null });
  await call('barcode_milo500', ani, 'find_product_by_barcode', { p_code: '8992696404441' });
  await call('barcode_via_merge', ani, 'find_product_by_barcode', { p_code: '9990000000012' });
  await call('barcode_unknown', ani, 'find_product_by_barcode', { p_code: '1234567890123' });

  // M2: R13 (semua + filter jenis + kosong) dan R14 per status, termasuk gambar terhapus retensi.
  const citra = new PgRpcClient(pool, USERS.c);
  await call('captures_all', citra, 'list_captures', { p_limit: 50, p_kind: null });
  await call('captures_receipt', citra, 'list_captures', { p_limit: 50, p_kind: 'receipt' });
  await call('captures_empty', budi, 'list_captures', { p_limit: 50, p_kind: null });
  for (const [k, id] of Object.entries(caps)) await call(`capture_${k}`, citra, 'get_capture', { p_capture_id: id });
  await pool.query(`update public.capture_image set purged_at = now() where capture_id = $1`, [caps.done]);
  await call('capture_purged', citra, 'get_capture', { p_capture_id: caps.done });
  await call('capture_unknown', citra, 'get_capture', { p_capture_id: IDS.unknown });
  await call('retry_not_failed', citra, 'retry_capture', { p_capture_id: caps.needs });
  await call('delete_not_allowed', citra, 'delete_capture', { p_capture_id: caps.needs });

  // M3 (S-10/S-11/S-12/S-14/S-15): keluaran R15/R16/R17 dan W4/W5/W8/W18 asli untuk Citra.
  type Line = { id: string; raw_text: string; needs_check: boolean; suggestion: { id: string } | null };
  const receiptOf = async (captureId: string) =>
    (await pool.query<{ id: string }>(`select id from public.receipt where capture_id = $1`, [captureId])).rows[0]!.id;
  await w.process(); // shopee-milo yang masih `uploaded` dari M2 (antrean urut waktu unggah)
  const aeonReceipt = await receiptOf(caps.needs);
  await call('receipt_aeon', citra, 'get_receipt', { p_receipt_id: aeonReceipt });
  await call('receipt_unknown', citra, 'get_receipt', { p_receipt_id: IDS.unknown });
  await call('confirm_receipt_undecided', citra, 'confirm_receipt', { p_receipt_id: aeonReceipt, p_lines: [] });
  const needLines = (data.receipt_aeon as { lines: Line[] }).lines.filter((l) => l.needs_check);
  // Benar untuk yang punya saran, Ganti (Milo 3in1) untuk sisanya.
  await call('confirm_receipt_ok', citra, 'confirm_receipt', {
    p_receipt_id: aeonReceipt,
    p_lines: needLines.map((l) =>
      l.suggestion
        ? { line_id: l.id, action: 'accept' }
        : { line_id: l.id, action: 'replace', product_id: IDS.milo3in1 },
    ),
  });
  await call('receipt_confirmed', citra, 'get_receipt', { p_receipt_id: aeonReceipt });
  // Struk yang sama diunggah lagi ("Tetap unggah", U-10) → banner duplikat D-20.
  const dupCapture = await w.submit('struk-aeon');
  await w.process();
  const dupReceipt = await receiptOf(dupCapture);
  await call('receipt_duplicate', citra, 'get_receipt', { p_receipt_id: dupReceipt });
  await call('confirm_receipt_duplicate', citra, 'confirm_receipt', { p_receipt_id: dupReceipt, p_lines: [] });
  // Toko tidak dikenali (D-49) + field ragu (field_confidence < τ).
  const noStoreCapture = await w.submit('struk-tanpa-toko');
  await w.process();
  const noStoreReceipt = await receiptOf(noStoreCapture);
  await call('receipt_nostore', citra, 'get_receipt', { p_receipt_id: noStoreReceipt });
  await call('confirm_receipt_nostore', citra, 'confirm_receipt', { p_receipt_id: noStoreReceipt, p_lines: [] });

  // Screenshot (shopee-milo, diproses di awal M3) dan label (label-milo, diunggah lagi).
  await call('items_shopee', citra, 'get_capture_items', { p_capture_id: caps.uploaded });
  const labelCapture = await w.submit('label-milo');
  await w.process();
  await call('items_label', citra, 'get_capture_items', { p_capture_id: labelCapture });
  await call('capture_label', citra, 'get_capture', { p_capture_id: labelCapture });
  await call('items_unknown', citra, 'get_capture_items', { p_capture_id: IDS.unknown });
  type Item = { id: string; updated_at: string };
  const [label1, label2] = data.items_label as Item[];
  await call('update_item_stale', citra, 'update_capture_item', {
    p_item_id: label1!.id,
    p_patch: { normal_price: 19000 },
    p_expected_updated_at: '2000-01-01T00:00:00+00:00',
  });
  await call('confirm_items_store_required', citra, 'confirm_capture_items', {
    p_capture_id: labelCapture,
    p_items: [{ item_id: label1!.id, action: 'accept' }],
  });
  // Hanya harga member, user bukan member → tidak ada harga yang berlaku.
  await call('update_item_member_only', citra, 'update_capture_item', {
    p_item_id: label2!.id,
    p_patch: { normal_price: null, store_id: IDS.aeon },
    p_expected_updated_at: label2!.updated_at,
  });
  // Harga member dengan program katalog; Citra bukan member → member tidak dihitung (D-27).
  await call('update_item_member_price', citra, 'update_capture_item', {
    p_item_id: label2!.id,
    p_patch: { member_price: 21000, member_program_id: IDS.aeonMember },
    p_expected_updated_at: (data.update_item_member_only as Item).updated_at,
  });
  await call('confirm_items_no_price', citra, 'confirm_capture_items', {
    p_capture_id: labelCapture,
    p_items: [{ item_id: label2!.id, action: 'accept' }],
  });
  await call('update_item_location', citra, 'update_capture_item', {
    p_item_id: label1!.id,
    p_patch: { store_id: IDS.aeon, branch_id: IDS.aeonBsd },
    p_expected_updated_at: label1!.updated_at,
  });
  await call('items_label_updated', citra, 'get_capture_items', { p_capture_id: labelCapture });
  await call('confirm_items_ok', citra, 'confirm_capture_items', {
    p_capture_id: labelCapture,
    p_items: [
      { item_id: label1!.id, action: 'accept' },
      { item_id: label2!.id, action: 'reject' },
    ],
  });
  // shopee-milo pertama di-auto-save (tier fuzzy, confidence 1). Diunggah lagi ("Tetap unggah"):
  // duplikat hash tidak pernah di-auto-save (D-71) → perlu dicek di S-11 (alur 5).
  const shopeeDup = await w.submit('shopee-milo');
  await w.process();
  await call('items_shopee_pending', citra, 'get_capture_items', { p_capture_id: shopeeDup });
  await call('capture_shopee', citra, 'get_capture', { p_capture_id: shopeeDup });
  const shopeeItem = (data.items_shopee_pending as Item[])[0]!;
  await call('confirm_items_shopee', citra, 'confirm_capture_items', {
    p_capture_id: shopeeDup,
    p_items: [{ item_id: shopeeItem.id, action: 'accept' }],
  });

  await call('programs', citra, 'get_my_programs');
  // S-12: R17 setelah konfirmasi; toko/cabang privat baru (W17).
  await call('recent_locations', citra, 'recent_locations', { p_limit: 10 });
  await call('recent_locations_empty', budi, 'recent_locations', { p_limit: 10 });
  await call('create_store', citra, 'create_private_store', {
    p_store: { id: 'c0000000-0000-0000-0000-000000000001', name: 'Toko Makmur Jaya', channel: 'offline' },
  });
  await call('create_branch', citra, 'create_private_branch', {
    p_branch: {
      id: 'c0000000-0000-0000-0000-000000000002',
      store_id: 'c0000000-0000-0000-0000-000000000001',
      name: 'Pasar Modern',
      city: 'Tangerang',
    },
  });
  // S-15: W8 sukses, ukuran kosong untuk kemasan (23514), barcode tumpang tindih (23P01).
  const newProduct = {
    name: 'Gula Aren Bubuk',
    variant: '250 g',
    brand: { new: 'Kebun Sari' },
    group: 'same_as_name',
    sale_mode: 'unit',
    pack_count: 1,
    content_size: 250,
    content_unit: 'g',
    barcodes: [{ code: '8990000000017', code_type: 'gtin' }],
  };
  await call('create_product_ok', citra, 'create_private_product', {
    p_product: { ...newProduct, id: 'c0000000-0000-0000-0000-000000000010' },
  });
  await call('create_product_23514', citra, 'create_private_product', {
    p_product: { ...newProduct, id: 'c0000000-0000-0000-0000-000000000011', content_size: null, barcodes: [] },
  });
  await call('create_product_23P01', citra, 'create_private_product', {
    p_product: { ...newProduct, id: 'c0000000-0000-0000-0000-000000000012', name: 'Gula Aren Cair' },
  });

  // S-01 "Harga baru masuk": REST price_record_view (docs/05 §3.3), sebagai user (RLS).
  const recentSql = `select id, product_id, transaction_date, effective_price, price_basis, store_name
                       from public.price_record_view where status = 'active'
                      order by transaction_date desc, created_at desc limit 10`;
  const asJson = (rows: Record<string, unknown>[]) =>
    rows.map((r) => ({ ...r, effective_price: Number(r.effective_price) }));
  data.recent_prices = asJson(
    (await ani.asUser<Record<string, unknown>>(`select to_jsonb(r) as j from (${recentSql}) r`)).rows.map(
      (r) => r.j as Record<string, unknown>,
    ),
  );
  data.recent_prices_empty = (await budi.asUser(`select 1 from (${recentSql}) r`)).rows;

  // S-12 / S-15: REST baca (docs/05 §3.3 S-12), sebagai user (RLS).
  const rows = async (sql: string, client = citra) =>
    (await client.asUser<{ j: Record<string, unknown> }>(`select to_jsonb(r) as j from (${sql}) r`)).rows.map(
      (r) => r.j,
    );
  data.rest_stores = await rows(
    `select id, name, channel, household_id from public.store where status = 'active' order by name limit 50`,
  );
  data.rest_branches_aeon = await rows(
    `select id, name, city, region, kind, status, household_id, store_id from public.branch
      where store_id = '${IDS.aeon}' order by status, name`,
  );
  data.rest_categories = await rows(
    `select id, name, household_id from public.category where archived_at is null order by name`,
  );

  await collectSessions(pool, w, ani, data);
  await collectCatalog(pool, citra, data);

  const today = (
    await pool.query<{ d: string }>(`select app.household_today($1)::text as d`, [await householdOf(pool, USERS.a)])
  ).rows[0]!.d;
  return { today, data };
}

/** Id sesi fixture (dibuat klien, F-16). */
export const SESSION_IDS = {
  aeonBsd: 'c0000000-0000-0000-0000-0000000000a1',
  closed: 'c0000000-0000-0000-0000-0000000000a2',
  expired: 'c0000000-0000-0000-0000-0000000000a3',
} as const;

/**
 * M4 (S-12 mode sesi, S-13, banner): R18/W11/W12/W13 ASLI untuk Ani (punya histori Milo, sehingga
 * vs_best_pct berarti). Label diunggah DENGAN shopping_session_id dan diproses pipeline worker:
 * label-milo → Milo 200 g auto-accept (lokasi dari sesi, docs/05 §5.5) + Milo 3in1 perlu dicek;
 * label-milo lagi (duplikat hash, tidak auto-save) → keduanya diterima → `done`; gambar tanpa
 * fixture → `failed` (seperti frame kamera palsu di e2e); satu lagi diklaim tanpa selesai. R18 diambil
 * sebelum dan sesudah antrean ringkasan (F-60).
 * Dijalankan paling akhir supaya fixture M1–M3 Ani tidak berubah.
 */
async function collectSessions(pool: pg.Pool, w: Worker, ani: PgRpcClient, data: Record<string, unknown>) {
  const call = async (key: string, fn: string, args: Record<string, unknown> = {}) => {
    const r = await ani.rpc(fn, args);
    data[key] = r.error ? { error: r.error } : r.data;
    return r.data;
  };
  const S = SESSION_IDS;
  await call('session_none', 'get_active_session');
  await call('session_start_closed', 'start_shopping_session', { p_session_id: S.closed, p_branch_id: IDS.aeonLama });
  await call('session_start', 'start_shopping_session', { p_session_id: S.aeonBsd, p_branch_id: IDS.aeonBsd });
  // Mengulang id yang sama = sesi yang sama (F-16, idempoten).
  await call('session_start_repeat', 'start_shopping_session', { p_session_id: S.aeonBsd, p_branch_id: IDS.aeonBsd });

  const opts = { userId: USERS.a, sessionId: S.aeonBsd };
  await w.submit('label-milo', opts);
  await call('session_uploaded', 'get_active_session');
  await w.process();
  // Duplikat hash (D-71): semua item pending → diterima user → capture `done`.
  const dup = await w.submit('label-milo', opts);
  await w.process();
  const items = (await ani.rpc('get_capture_items', { p_capture_id: dup })).data as { id: string }[];
  const saved = await ani.rpc('confirm_capture_items', {
    p_capture_id: dup,
    p_items: [
      { item_id: items[0]!.id, action: 'accept' },
      { item_id: items[1]!.id, action: 'accept', product_id: IDS.milo3in1 },
    ],
  });
  if (saved.error) throw new Error(`confirm_capture_items: ${saved.error.message}`);
  await w.submitBytes(Buffer.from('frame kamera label tanpa fixture'), 'price_label', opts);
  await w.process();
  await w.submitBytes(Buffer.from('frame kamera label diproses'), 'price_label', opts);
  await w.workerDb.query(`select * from app.claim_next_capture('w-web-fixtures', 'stub', null, 'stub-1')`);
  // Sebelum antrean ringkasan (D-31) berjalan: vs_best_pct terhadap ringkasan lama (Milo 200 g
  // lebih murah dari termurah 90 hari; Milo 3in1 tanpa data 90 hari → null).
  await call('session_labels', 'get_active_session');
  // Setelah ringkasan dihitung ulang, record sesi ikut ringkasan → harga terbaru = termurah (0 %), F-60.
  await pool.query('select app.process_summary_queue()');
  await call('session_labels_refreshed', 'get_active_session');

  // Hampir kedaluwarsa (< 30 mnt): data test saja, expires_at dimajukan.
  await pool.query(`update public.shopping_session set expires_at = now() + interval '20 minutes' where id = $1`, [
    S.aeonBsd,
  ]);
  await call('session_near_expiry', 'get_active_session');
  await call('session_extend', 'extend_shopping_session', { p_session_id: S.aeonBsd });
  await call('session_end', 'end_shopping_session', { p_session_id: S.aeonBsd });
  await call('session_end_repeat', 'end_shopping_session', { p_session_id: S.aeonBsd });
  await call('session_extend_ended', 'extend_shopping_session', { p_session_id: S.aeonBsd });
  await call('session_after_end', 'get_active_session');

  // Kedaluwarsa otomatis (D-43): R18 null, perpanjang → SESSION_NOT_ACTIVE.
  await call('session_start_expired', 'start_shopping_session', { p_session_id: S.expired, p_branch_id: IDS.aeonBsd });
  await pool.query(
    `update public.shopping_session set started_at = now() - interval '5 hours', expires_at = now() - interval '1 hour'
      where id = $1`,
    [S.expired],
  );
  await call('session_expired', 'get_active_session');
  await call('session_extend_expired', 'extend_shopping_session', { p_session_id: S.expired });
}

/** Id produk privat Citra untuk S-15 edit / S-17 / S-18 (dibuat lewat W8 dengan id klien). */
export const CATALOG_IDS = {
  /** "Gula Aren Bubuk" 250 g dari fixture M3 (create_product_ok): target merge. */
  gulaAren: 'c0000000-0000-0000-0000-000000000010',
  /** Dobel 250 g dengan barcode: sumber merge (ukuran sama). */
  dup: 'c0000000-0000-0000-0000-000000000020',
  /** 1 kg: beda ukuran (U-16). */
  big: 'c0000000-0000-0000-0000-000000000021',
  /** 500 ml: beda dimensi. */
  syrup: 'c0000000-0000-0000-0000-000000000022',
  /** Produk timbang dengan PLU per toko (F-55). */
  plu: 'c0000000-0000-0000-0000-000000000023',
} as const;

/** Kolom `product` yang dibaca/ditulis lewat REST di S-15 edit dan S-17 (docs/05 §3.3). */
export const PRODUCT_REST_COLUMNS =
  'id, household_id, name, variant, brand_id, product_group_id, category_id, sale_mode, pack_count, content_size, content_unit, status, updated_at';

/**
 * M5 (S-15 edit, S-16, S-17, S-18): R19/R20/W6/W7/W9/W10 + REST product ASLI untuk Citra (punya
 * record struk, label, dan screenshot dari M3). Dijalankan paling akhir supaya fixture M1–M4 tidak
 * berubah. Record/produk Ani dipakai untuk kasus lintas household (RECORDS_NOT_OWNED, target lain).
 */
async function collectCatalog(pool: pg.Pool, citra: PgRpcClient, data: Record<string, unknown>) {
  const call = async (key: string, client: PgRpcClient, fn: string, args: Record<string, unknown> = {}) => {
    const r = await client.rpc(fn, args);
    data[key] = r.error ? { error: r.error } : r.data;
    return r.data;
  };
  const C = CATALOG_IDS;
  const citraHh = await householdOf(pool, USERS.c);
  type Rec = { id: string; source_type: string; capture_id: string | null };
  const recs = (
    await pool.query<Rec>(
      `select id, source_type, capture_id from public.price_record
        where household_id = $1 and status = 'active' order by created_at, id`,
      [citraHh],
    )
  ).rows;
  const receiptRec = recs.find((r) => r.source_type === 'receipt')!.id;
  const labelRec = recs.find((r) => r.source_type === 'price_label')!.id;
  const shopeeRec = recs.find((r) => r.source_type === 'marketplace')!.id;
  type Detail = {
    record: { updated_at: string; capture_id: string };
    receipt_line: { id: string; updated_at: string };
  };
  const detail = async (key: string, id: string) =>
    (await call(key, citra, 'price_record_detail', { p_id: id })) as Detail;

  // R20 per sumber.
  const label = await detail('record_label', labelRec);
  const receipt = await detail('record_receipt', receiptRec);
  const shopee = await detail('record_shopee', shopeeRec);
  await call('record_unknown', citra, 'price_record_detail', { p_id: IDS.unknown });
  // S-18 langkah 2: daftar record produk asal (struk + screenshot, dua toko), sebelum dikoreksi.
  await call('split_history', citra, 'price_history', { p_product_id: IDS.milo500, p_include_void: false });
  // Dua record screenshot bertanggal sama: R8 mengurutkannya dengan id (acak per run). Urutan dibuat
  // tetap (created_at) supaya pemeriksaan bentuk fixture deterministik; isinya tetap keluaran R8.
  (data.split_history as { transaction_date: string; created_at: string }[]).sort(
    (a, b) => b.transaction_date.localeCompare(a.transaction_date) || a.created_at.localeCompare(b.created_at),
  );

  // W6 observasi: ubah harga normal (hitung ulang D-26) → riwayat audit.
  await call('correct_label_ok', citra, 'correct_price_record', {
    p_id: labelRec,
    p_patch: { normal_price: 19900 },
    p_expected_updated_at: label.record.updated_at,
  });
  const labelAfter = await detail('record_label_corrected', labelRec);
  await call('correct_stale', citra, 'correct_price_record', {
    p_id: labelRec,
    p_patch: { normal_price: 19000 },
    p_expected_updated_at: '2000-01-01T00:00:00+00:00',
  });
  await call('correct_no_price', citra, 'correct_price_record', {
    p_id: labelRec,
    p_patch: { normal_price: null, promo_price: null, member_price: null },
    p_expected_updated_at: labelAfter.record.updated_at,
  });
  // Record struk: angka → USE_RECEIPT_LINE (D-23).
  await call('correct_use_receipt_line', citra, 'correct_price_record', {
    p_id: receiptRec,
    p_patch: { normal_price: 1000 },
    p_expected_updated_at: receipt.record.updated_at,
  });
  // Screenshot: extra di luar kontrak D-66 → INVALID_EXTRA; ongkir + catatan (extra lengkap); batalkan.
  await call('correct_invalid_extra', citra, 'correct_price_record', {
    p_id: shopeeRec,
    p_patch: { extra: { kupon: 5000 } },
    p_expected_updated_at: shopee.record.updated_at,
  });
  const shopeeExtra = (await call('correct_extra', citra, 'correct_price_record', {
    p_id: shopeeRec,
    p_patch: { extra: { listing_title: 'Milo Activ-Go 500g', shipping_fee: 12000, note: 'beli 2' } },
    p_expected_updated_at: shopee.record.updated_at,
  })) as { updated_at: string };
  await call('correct_void', citra, 'correct_price_record', {
    p_id: shopeeRec,
    p_patch: { status: 'void' },
    p_expected_updated_at: shopeeExtra.updated_at,
  });
  await detail('record_shopee_void', shopeeRec);

  // Record struk: ganti produk + alias (D-35), lalu ubah baris struk lewat W7 (record dibentuk ulang).
  await call('correct_product_alias', citra, 'correct_price_record', {
    p_id: receiptRec,
    p_patch: { product_id: IDS.milo200 },
    p_expected_updated_at: receipt.record.updated_at,
    p_update_alias: true,
  });
  const receiptAfter = await detail('record_receipt_corrected', receiptRec);
  await call('correct_line_ok', citra, 'correct_receipt_line', {
    p_line_id: receiptAfter.receipt_line.id,
    p_patch: { line_amount: 88000 },
    p_expected_updated_at: receiptAfter.receipt_line.updated_at,
  });
  await call('correct_line_stale', citra, 'correct_receipt_line', {
    p_line_id: receiptAfter.receipt_line.id,
    p_patch: { line_amount: 86000 },
    p_expected_updated_at: receiptAfter.receipt_line.updated_at,
  });
  await detail('record_receipt_line_corrected', receiptRec);

  // Gambar sumber dihapus retensi (D-32).
  await pool.query(`update public.capture_image set purged_at = now() where capture_id = $1`, [
    label.record.capture_id,
  ]);
  await detail('record_label_purged', labelRec);

  // W8: produk privat untuk merge/split (ukuran sama + barcode, 1 kg, 500 ml, timbang + PLU per toko).
  const base = { brand: { new: 'Kebun Sari' }, group: 'same_as_name', sale_mode: 'unit', pack_count: 1 };
  for (const p of [
    {
      id: C.dup,
      name: 'Gula Aren Bubuk Kebun',
      content_size: 250,
      content_unit: 'g',
      barcodes: [{ code: '8990000000024', code_type: 'gtin' }],
    },
    { id: C.big, name: 'Gula Aren Bubuk', variant: '1 kg', content_size: 1, content_unit: 'kg', barcodes: [] },
    { id: C.syrup, name: 'Sirup Gula Aren', content_size: 500, content_unit: 'ml', barcodes: [] },
  ]) {
    const r = await citra.rpc('create_private_product', { p_product: { ...base, ...p } });
    if (r.error) throw new Error(`create_private_product: ${r.error.message}`);
  }
  await call('create_product_plu', citra, 'create_private_product', {
    p_product: {
      id: C.plu,
      name: 'Jeruk Pontianak',
      group: 'same_as_name',
      sale_mode: 'weight',
      content_unit: 'kg',
      barcodes: [{ code: '2001', code_type: 'plu', store_id: IDS.aeon }],
    },
  });

  // W9 (T2): pindahkan record label + struk Citra ke produk dobel, dengan alias household.
  const moveIds = [labelRec, receiptRec];
  await call('move_ok', citra, 'move_price_records', {
    p_record_ids: moveIds,
    p_target_product_id: C.dup,
    p_alias: { store_id: IDS.aeon, alias_text: 'GULA AREN BBK' },
  });
  await call('move_repeat', citra, 'move_price_records', { p_record_ids: moveIds, p_target_product_id: C.dup });
  const aniRec = (
    await pool.query<{ id: string }>(
      `select id from public.price_record where household_id = $1 order by created_at, id limit 1`,
      [await householdOf(pool, USERS.a)],
    )
  ).rows[0]!.id;
  await call('move_not_owned', citra, 'move_price_records', {
    p_record_ids: [labelRec, aniRec],
    p_target_product_id: C.dup,
  });
  await call('move_target_missing', citra, 'move_price_records', {
    p_record_ids: [labelRec],
    p_target_product_id: IDS.unknown,
  });

  // R19 pratinjau (U-16, F-01/D-65).
  await call('merge_preview_ok', citra, 'merge_product_preview', { p_from: C.dup, p_into: C.gulaAren });
  await call('merge_preview_size', citra, 'merge_product_preview', { p_from: C.dup, p_into: C.big });
  await call('merge_preview_dimension', citra, 'merge_product_preview', { p_from: C.dup, p_into: C.syrup });
  await call('merge_preview_global_target', citra, 'merge_product_preview', { p_from: C.dup, p_into: IDS.milo200 });
  await call('merge_preview_source_global', citra, 'merge_product_preview', {
    p_from: IDS.milo200,
    p_into: C.gulaAren,
  });
  await call('merge_preview_unknown', citra, 'merge_product_preview', { p_from: C.dup, p_into: IDS.unknown });
  // W10: global tidak bisa memulai (D-30, 42501); sukses; ulang = sudah merged ke target sama.
  await call('merge_forbidden', citra, 'merge_product', { p_from: IDS.milo200, p_into: C.gulaAren });
  await call('merge_ok', citra, 'merge_product', { p_from: C.dup, p_into: C.gulaAren });
  await call('merge_preview_already', citra, 'merge_product_preview', { p_from: C.dup, p_into: C.gulaAren });
  await call('merge_repeat', citra, 'merge_product', { p_from: C.dup, p_into: C.gulaAren });
  await call('merge_target_inactive', citra, 'merge_product', { p_from: C.big, p_into: C.dup });
  await call('merge_target_other', citra, 'merge_product', { p_from: C.big, p_into: IDS.gula });
  await call('detail_merged_target', citra, 'get_product_detail', { p_product_id: C.gulaAren });

  // REST product (S-15 edit, arsip, "Pindahkan ke group"): sebagai user (RLS), filter updated_at.
  const rest = async (key: string, sql: string, params: unknown[]) => {
    try {
      const r = await citra.asUser<{ j: Record<string, unknown> }>(sql, params);
      data[key] = r.rows.map((x) => x.j);
    } catch (e) {
      const err = e as pg.DatabaseError;
      data[key] = {
        error: { message: err.message, code: err.code ?? null, details: err.detail ?? null, hint: err.hint ?? null },
      };
    }
    return data[key] as Record<string, unknown>[];
  };
  const cols = PRODUCT_REST_COLUMNS;
  const select = `select to_jsonb(r) as j from (select ${cols} from public.product where id = $1) r`;
  const [syrupRow] = await rest('rest_product', select, [C.syrup]);
  await rest('rest_product_global', select, [IDS.milo200]);
  // UPDATE … RETURNING sama dengan PATCH + Prefer: return=representation (0 baris = konflik).
  const patch = (set: string) =>
    `with u as (update public.product set ${set} where id = $1 and updated_at = $2 returning ${cols})
     select to_jsonb(u) as j from u`;
  const [patched] = await rest('patch_product_ok', patch(`name = 'Sirup Gula Aren Asli', content_size = 600`), [
    C.syrup,
    syrupRow!.updated_at,
  ]);
  await rest('patch_product_stale', patch(`name = 'Sirup Lama'`), [C.syrup, syrupRow!.updated_at]);
  await rest('patch_product_23514', patch(`content_size = null`), [C.syrup, patched!.updated_at]);
  await rest('patch_product_23503', patch(`product_group_id = '${IDS.unknown}'`), [C.syrup, patched!.updated_at]);
  const [bigRow] = await rest('rest_product_big', select, [C.big]);
  await rest('patch_product_group', patch(`product_group_id = '${IDS.groupMilo}'`), [C.big, bigRow!.updated_at]);
  await rest('patch_product_archive', patch(`status = 'archived'`), [C.syrup, patched!.updated_at]);
}
