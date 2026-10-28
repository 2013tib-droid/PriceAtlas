// L3: worker end-to-end dengan fixture (docs/05 §8.1): unggah → claim → apply → konfirmasi.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS, rpcOk } from '@priceatlas/testkit';
import { FixtureRegistry, StubAiMatcher, StubExtractor } from '../src/extractors/stub.ts';
import { processNextCapture } from '../src/pipeline/process-capture.ts';
import { FIXTURES_DIR, captureRow, fixtureImages, setupEnv, skipBackoff, submitFixture, type Env } from './helpers.ts';

let env: Env;
beforeAll(() => {
  env = setupEnv('priceatlas_l3_e2e');
});
afterAll(async () => {
  await env.close();
});

type ReceiptPayload = {
  header: Record<string, unknown>;
  lines: { id: string; line_no: number; line_type: string; needs_check: boolean; suggestion: { id: string } | null; record: unknown; match_tier: string | null }[];
};

it('worker terhubung sebagai service_role (hak sama dengan Supabase)', async () => {
  expect((await env.workerDb.query('select current_user as u')).rows[0].u).toBe('service_role');
});

describe('struk AEON: sebagian auto-save, sisanya dikonfirmasi user', () => {
  let captureId: string;
  let receiptId: string;

  it('submit + proses → needs_confirmation', async () => {
    ({ captureId } = await submitFixture(env, 'struk-aeon'));
    const r = await processNextCapture(env.deps);
    expect(r).toMatchObject({ captureId, status: 'needs_confirmation', attempt: 1 });
    expect((await captureRow(env, captureId)).status).toBe('needs_confirmation');
  });

  it('data mentah disimpan di processing_run, pii di receipt.pii (tidak terbaca user)', async () => {
    const run = await env.admin.query('select * from public.processing_run where capture_id = $1', [captureId]);
    expect(run.rows[0]).toMatchObject({ status: 'succeeded', ocr_engine: 'stub', prompt_version: 'stub-1' });
    expect(run.rows[0].raw_ocr_text).toContain('MILO ORI 500G');
    expect(run.rows[0].raw_ai_output.kind).toBe('receipt');
    const rc = await env.admin.query('select id, pii, store_id, branch_id, status from public.receipt where capture_id = $1', [captureId]);
    receiptId = rc.rows[0].id;
    expect(rc.rows[0]).toMatchObject({
      pii: { card_last4: '4321', phone: '081298765432' },
      store_id: '20000000-0000-0000-0000-000000000001',
      branch_id: '30000000-0000-0000-0000-000000000001',
      status: 'draft',
    });
    const { error } = await env.ani.rpc('get_receipt', { p_receipt_id: receiptId });
    expect(error).toBeNull();
  });

  it('get_receipt: baris barcode auto-save, Indomie fuzzy/kandidat, SNACK dari AI (tier 4)', async () => {
    const r = await rpcOk<ReceiptPayload>(env.ani, 'get_receipt', { p_receipt_id: receiptId });
    expect(JSON.stringify(r)).not.toContain('4321');
    const byNo = new Map(r.lines.map((l) => [l.line_no, l]));
    expect(byNo.get(1)).toMatchObject({ match_tier: 'barcode', needs_check: false });
    expect(byNo.get(1)?.record).toMatchObject({ match_outcome: 'auto', effective_price: 42500, price_basis: 'promo' });
    expect(byNo.get(3)?.needs_check).toBe(true);
    expect(byNo.get(5)).toMatchObject({ match_tier: 'ai', needs_check: true, suggestion: { id: '70000000-0000-0000-0000-000000000310' } });
    expect(byNo.get(4)?.line_type).toBe('non_product');
  });

  it('konfirmasi: accept / replace → done, alias household dibuat', async () => {
    const r = await rpcOk<ReceiptPayload>(env.ani, 'get_receipt', { p_receipt_id: receiptId });
    const decisions = r.lines
      .filter((l) => l.needs_check)
      .map((l) =>
        l.line_no === 3
          ? { line_id: l.id, action: 'replace', product_id: '70000000-0000-0000-0000-000000000085' }
          : { line_id: l.id, action: 'accept' },
      );
    const res = await rpcOk<{ saved_count: number; receipt_status: string }>(env.ani, 'confirm_receipt', {
      p_receipt_id: receiptId,
      p_lines: decisions,
    });
    expect(res).toMatchObject({ saved_count: 3, receipt_status: 'confirmed' });
    expect((await captureRow(env, captureId)).status).toBe('done');
    const alias = await env.admin.query(
      `select normalized_text, product_id from public.product_alias where household_id is not null order by 1`,
    );
    expect(alias.rows).toEqual([
      { normalized_text: 'indomie grg 85g', product_id: '70000000-0000-0000-0000-000000000085' },
      { normalized_text: 'snack xyz', product_id: '70000000-0000-0000-0000-000000000310' },
    ]);
  });

  it('ringkasan menyusul (antrean) → kartu produk menampilkan harga terbaik', async () => {
    await env.admin.query('select app.process_summary_queue()');
    const cards = await rpcOk<{ summary: { best_all: { effective_price: number; price_basis: string } } }[]>(
      env.ani, 'get_product_cards', { p_ids: ['70000000-0000-0000-0000-000000000500'] },
    );
    expect(cards[0]?.summary.best_all).toMatchObject({ effective_price: 42500, price_basis: 'promo' });
  });

  it('gambar yang sama diunggah lagi → dicurigai duplikat (hash), keputusan user wajib', async () => {
    const { captureId: dupId } = await submitFixture(env, 'struk-aeon');
    expect((await processNextCapture(env.deps))?.status).toBe('needs_confirmation');
    const rc = await env.admin.query('select id, duplicate_of_receipt_id from public.receipt where capture_id = $1', [dupId]);
    expect(rc.rows[0].duplicate_of_receipt_id).toBe(receiptId);
    const { error } = await env.ani.rpc('confirm_receipt', { p_receipt_id: rc.rows[0].id, p_lines: [] });
    expect(error).toMatchObject({ message: 'DUPLICATE_DECISION_REQUIRED', code: 'PT409' });
    await rpcOk(env.ani, 'confirm_receipt', { p_receipt_id: rc.rows[0].id, p_lines: [], p_duplicate_decision: 'discard' });
    expect((await captureRow(env, dupId)).status).toBe('done');
  });
});

describe('label harga di sesi belanja', () => {
  it('item barcode auto-accept, item member menunggu; "Saya member" lalu simpan', async () => {
    const sessionId = '5e000000-0000-4000-8000-000000000001';
    await rpcOk(env.ani, 'start_shopping_session', { p_session_id: sessionId, p_branch_id: '30000000-0000-0000-0000-000000000001' });
    const { captureId } = await submitFixture(env, 'label-milo', { sessionId });
    expect((await processNextCapture(env.deps))?.status).toBe('needs_confirmation');

    const items = await rpcOk<{ id: string; position: number; status: string; computed: { price_basis: string; effective_price: number } }[]>(
      env.ani, 'get_capture_items', { p_capture_id: captureId },
    );
    expect(items.map((i) => i.status)).toEqual(['accepted', 'pending']);
    expect(items[0]?.computed).toMatchObject({ price_basis: 'promo', effective_price: 17500 });
    expect(items[1]?.computed.price_basis).toBe('normal');

    await rpcOk(env.ani, 'set_program_membership', { p_program_id: '40000000-0000-0000-0000-000000000001', p_member: true });
    const after = await rpcOk<{ computed: { price_basis: string; effective_price: number } }[]>(env.ani, 'get_capture_items', { p_capture_id: captureId });
    expect(after[1]?.computed).toMatchObject({ price_basis: 'member', effective_price: 21000 });

    const saved = await rpcOk<{ remaining_pending: number }>(env.ani, 'confirm_capture_items', {
      p_capture_id: captureId,
      p_items: [{ item_id: items[1]!.id, action: 'accept', product_id: '70000000-0000-0000-0000-000000000310' }],
    });
    expect(saved.remaining_pending).toBe(0);
    expect((await captureRow(env, captureId)).status).toBe('done');

    const session = await rpcOk<{ labels: { product: { id: string }; price_basis: string }[] }>(env.ani, 'get_active_session');
    expect(session.labels.map((l) => l.price_basis).sort()).toEqual(['member', 'promo']);
  });
});

describe('screenshot marketplace', () => {
  it('platform dari store_hint, seller global, ongkir sebagai info', async () => {
    const { captureId } = await submitFixture(env, 'shopee-milo');
    await processNextCapture(env.deps);
    const items = await rpcOk<{ status: string; store_id: string; extra: Record<string, unknown> }[]>(env.ani, 'get_capture_items', { p_capture_id: captureId });
    expect(items[0]).toMatchObject({ store_id: '20000000-0000-0000-0000-000000000004', extra: { shipping_fee: 9000 } });
    if (items[0]?.status === 'pending') {
      await rpcOk(env.ani, 'confirm_capture_items', {
        p_capture_id: captureId,
        p_items: [{ item_id: (items[0] as unknown as { id: string }).id, action: 'accept', product_id: '70000000-0000-0000-0000-000000000500' }],
      });
    }
    const rec = await env.admin.query('select * from public.price_record where capture_id = $1', [captureId]);
    expect(rec.rows[0]).toMatchObject({ source_type: 'marketplace', branch_id: '30000000-0000-0000-0000-000000000005' });
    expect(Number(rec.rows[0].effective_price)).toBe(47000);
  });
});

describe('fixture 6b M4 (Q-78, Q-82)', () => {
  it('screenshot confidence harga rendah → perlu dicek pada unggahan PERTAMA (e2e alur 5)', async () => {
    const { captureId } = await submitFixture(env, 'shopee-milo-ragu', { user: USERS.b });
    expect(await processNextCapture(env.deps)).toMatchObject({ captureId, status: 'needs_confirmation' });
    const row = await env.admin.query('select status, normal_price, extra, suggested_product_id, store_id from public.capture_item where capture_id = $1', [captureId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({
      status: 'pending',
      extra: { shipping_fee: 9000 },
      suggested_product_id: '70000000-0000-0000-0000-000000000500',
      store_id: '20000000-0000-0000-0000-000000000004',
    });
    expect(Number(row.rows[0].normal_price)).toBe(46500);
  });

  it('STUB_FALLBACK_FIXTURE: gambar tanpa fixture (frame kamera) diproses sebagai fixture cadangan', async () => {
    const fb = new FixtureRegistry(FIXTURES_DIR, { fallback: 'label-kamera' });
    const { uploadAndSubmit } = await import('../scripts/client-sim.ts');
    const { captureId } = await uploadAndSubmit({
      pool: env.admin, blob: env.blob, userId: USERS.b, kind: 'price_label',
      // JPEG valid dengan sha256 tanpa fixture (seperti frame kamera palsu Chromium).
      images: [Buffer.concat([fixtureImages('label-milo')[0]!, Buffer.from('frame kamera')])],
    });
    const r = await processNextCapture({ ...env.deps, extractor: new StubExtractor(fb), ai: new StubAiMatcher(fb) });
    expect(r).toMatchObject({ captureId });
    expect(await captureRow(env, captureId)).toMatchObject({ error_code: null });
    const row = await env.admin.query('select raw_text from public.capture_item where capture_id = $1', [captureId]);
    expect(row.rows.map((x) => x.raw_text)).toEqual(['INDOMIE GRG 85G']);
  });
});

describe('gagal dan retry (§5.3)', () => {
  it('gagal permanen → failed + error_code; retry user memulai putaran baru', async () => {
    const { captureId } = await submitFixture(env, 'struk-buram');
    expect((await processNextCapture(env.deps))?.status).toBe('failed');
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'failed', error_code: 'blurry' });
    const list = await rpcOk<{ id: string; error_code: string; attempts: number }[]>(env.ani, 'list_captures', {});
    expect(list.find((c) => c.id === captureId)).toMatchObject({ error_code: 'blurry', attempts: 1 });
    await rpcOk(env.ani, 'retry_capture', { p_capture_id: captureId });
    expect((await processNextCapture(env.deps))).toMatchObject({ captureId, attempt: 1, status: 'failed' });
  });

  it('gagal sementara 2× → retry otomatis dengan backoff → sukses dan auto-save', async () => {
    const { captureId } = await submitFixture(env, 'struk-alfamart-timeout');
    expect(await processNextCapture(env.deps)).toMatchObject({ captureId, attempt: 1, status: 'uploaded' });
    expect(await processNextCapture(env.deps)).toBeNull();                       // backoff 30 detik
    await skipBackoff(env, captureId);
    expect(await processNextCapture(env.deps)).toMatchObject({ attempt: 2, status: 'uploaded' });
    await skipBackoff(env, captureId);
    expect(await processNextCapture(env.deps)).toMatchObject({ attempt: 3, status: 'done' });
    const rc = await env.admin.query('select status, branch_id from public.receipt where capture_id = $1', [captureId]);
    expect(rc.rows[0]).toEqual({ status: 'confirmed', branch_id: '30000000-0000-0000-0000-000000000002' });
  });

  it('gambar tanpa fixture → unsupported', async () => {
    const { uploadAndSubmit } = await import('../scripts/client-sim.ts');
    const { captureId } = await uploadAndSubmit({
      pool: env.admin, blob: env.blob, userId: USERS.b, kind: 'receipt', images: [Buffer.from('foto kucing')],
    });
    expect(await processNextCapture(env.deps)).toMatchObject({ captureId, status: 'failed' });
    expect((await captureRow(env, captureId)).error_code).toBe('unsupported');
  });

  it('worker basi: run di-reap saat worker masih bekerja → hasil dibuang', async () => {
    const { captureId } = await submitFixture(env, 'shopee-milo', { user: USERS.b });
    const r = await processNextCapture({
      ...env.deps,
      hooks: {
        afterClaim: async (claim) => {
          await env.admin.query(`update public.processing_run set started_at = now() - interval '1 hour' where id = $1`, [claim.run_id]);
          await env.admin.query('select app.reap_stale_runs()');
        },
      },
    });
    expect(r?.status).toBe('stale');
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'uploaded' });
    const items = await env.admin.query('select count(*)::int as n from public.capture_item where capture_id = $1', [captureId]);
    expect(items.rows[0].n).toBe(0);
  });

  it('log worker tidak memuat teks OCR atau pii', async () => {
    const { logs } = await import('./helpers.ts');
    const all = logs.join('\n');
    expect(all).toContain('capture.applied');
    expect(all).not.toMatch(/4321|081298765432|MILO ORI/);
  });
});
