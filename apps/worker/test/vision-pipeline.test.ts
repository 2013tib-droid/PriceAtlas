// L3 (docs/08 §13.2): VisionExtractor dengan klien Claude palsu (respons rekaman sintetis) melewati
// pipeline penuh: prepareImages → Claude → convert → kontrak → record_run_output → matching → apply.
// Termasuk refusal, max_tokens, output tidak valid, bukan struk, gambar rusak, dan tenggat lease.
// VisionExtractor belum dipasang ke buildDeps (M2); EXTRACTOR produksi tetap `stub`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from '@priceatlas/testkit';
import { VisionExtractor } from '../src/extractors/vision.ts';
import { processNextCapture, type PipelineDeps } from '../src/pipeline/process-capture.ts';
import { uploadAndSubmit } from '../scripts/client-sim.ts';
import { FakeClaude, apiError, fakeMessage, llmLabelMilo, llmStrukAeon } from './claude-fake.ts';
import { captureRow, setupEnv, skipBackoff, submitFixture, type Env } from './helpers.ts';

let env: Env;
beforeAll(() => {
  env = setupEnv('priceatlas_l3_vision', 'w-vision');
});
afterAll(async () => {
  await env.close();
});

const CFG = { model: 'claude-opus-5-5', effortReceipt: 'medium' as const, effortObservation: 'low' as const };

function depsWith(fake: FakeClaude, over: Partial<PipelineDeps> = {}): PipelineDeps {
  return { ...env.deps, extractor: new VisionExtractor(fake, CFG), ...over };
}

async function runRow(captureId: string) {
  const r = await env.admin.query(
    'select status, ocr_engine, ai_model, prompt_version, raw_ocr_text, raw_ai_output, input_tokens, output_tokens, cost_usd from public.processing_run where capture_id = $1 order by started_at',
    [captureId],
  );
  return r.rows;
}

describe('berhasil', () => {
  it('struk-aeon: needs_confirmation, transkripsi + output mentah + biaya tercatat, member_discount diterima', async () => {
    const fake = new FakeClaude(fakeMessage({ json: llmStrukAeon(), usage: { input_tokens: 6000, output_tokens: 3000 } }));
    const { captureId } = await submitFixture(env, 'struk-aeon');
    const res = await processNextCapture(depsWith(fake));
    expect(res).toMatchObject({ captureId, status: 'needs_confirmation' });

    // Permintaan: satu gambar JPEG bersih, label bagian, konteks tanggal, prompt struk v1, tenggat.
    const call = fake.calls[0]!;
    const content = call.params.messages[0]!.content as { type: string; text?: string; source?: { media_type: string } }[];
    expect(content.map((b) => b.type)).toEqual(['text', 'text', 'image']);
    expect(content[0]!.text).toMatch(/^Jenis: struk\. Tanggal unggah \(Asia\/Jakarta\): \d{4}-\d{2}-\d{2}\. Jumlah bagian: 1\.$/);
    expect(content[1]!.text).toBe('Bagian 1 dari 1');
    expect(content[2]!.source!.media_type).toBe('image/jpeg');
    expect(call.params.output_config).toMatchObject({ effort: 'medium' });
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(call.signal!.aborted).toBe(false);

    const [run] = await runRow(captureId);
    expect(run).toMatchObject({ status: 'succeeded', ocr_engine: 'claude-vision', ai_model: 'claude-opus-5-5', prompt_version: 'v1', input_tokens: 6000, output_tokens: 3000 });
    expect(Number(run.cost_usd)).toBeCloseTo(0.084, 6);
    expect(run.raw_ocr_text).toContain('MILO ORI 500G');
    expect(run.raw_ocr_text).not.toContain('081298765432');
    expect(run.raw_ai_output.llm.store.name).toBe('AEON');
    expect(run.raw_ai_output.meta).toMatchObject({ served_model: 'claude-opus-5-5', prompt_version: 'v1', kind: 'receipt', flags: [] });

    const lines = await env.admin.query(
      `select l.line_no, l.line_type from public.receipt_line l join public.receipt r on r.id = l.receipt_id
        where r.capture_id = $1 order by l.line_no`,
      [captureId],
    );
    expect(lines.rows.map((l) => [l.line_no, l.line_type])).toEqual([
      [1, 'product'], [2, 'discount'], [3, 'product'], [4, 'non_product'], [5, 'product'],
    ]);
    const rc = await env.admin.query('select pii from public.receipt where capture_id = $1', [captureId]);
    expect(rc.rows[0].pii).toMatchObject({ card_last4: '4321', phone: '081298765432' });
  });

  it('label-milo: dua item, harga member terpisah dari promo', async () => {
    const fake = new FakeClaude(fakeMessage({ json: llmLabelMilo() }));
    const { captureId } = await submitFixture(env, 'label-milo');
    const res = await processNextCapture(depsWith(fake));
    expect(['needs_confirmation', 'done']).toContain(res?.status);
    expect(fake.calls[0]!.params.output_config).toMatchObject({ effort: 'low' });
    expect((fake.calls[0]!.params.messages[0]!.content as { text?: string }[])[1]!.text).toBe('Gambar 1 dari 1');
    const items = await env.admin.query(
      'select raw_text, normal_price, promo_price, member_price, extra from public.capture_item where capture_id = $1 order by raw_text desc',
      [captureId],
    );
    expect(items.rows.map((r) => [r.raw_text, Number(r.normal_price), r.promo_price && Number(r.promo_price), r.member_price])).toEqual([
      ['MILO ORIGINAL 200G', 19500, 17500, null],
      ['MILO 3IN1 10X35G', 23000, null, null],
    ]);
    // Tanpa toko, harga member tidak bisa dipetakan ke program (F-57, Q-77): disimpan sebagai catatan.
    expect(JSON.stringify(items.rows[1].extra)).toContain('21000');
  });
});

describe('gagal setelah respons: output mentah dan biaya tetap tersimpan', () => {
  it('refusal → failed `other`', async () => {
    const { captureId } = await submitFixture(env, 'struk-alfamart-timeout');
    const res = await processNextCapture(depsWith(new FakeClaude(fakeMessage({ text: '', stop_reason: 'refusal' }))));
    expect(res).toMatchObject({ captureId, status: 'failed' });
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'failed', error_code: 'other' });
    const [run] = await runRow(captureId);
    expect(run.raw_ai_output.meta.stop_reason).toBe('refusal');
    expect(Number(run.cost_usd)).toBeGreaterThan(0);
  });

  it('max_tokens: percobaan 1 diulang (max_tokens × 2), percobaan 2 permanen', async () => {
    const cut = () => fakeMessage({ text: '{"document":', stop_reason: 'max_tokens' });
    const fake = new FakeClaude(cut(), cut());
    const { captureId } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(depsWith(fake))).toMatchObject({ captureId, attempt: 1, status: 'uploaded' });
    await skipBackoff(env, captureId);
    expect(await processNextCapture(depsWith(fake))).toMatchObject({ captureId, attempt: 2, status: 'failed' });
    expect(fake.calls.map((c) => c.params.max_tokens)).toEqual([16000, 32000]);
    const runs = await runRow(captureId);
    expect(runs.map((r) => r.raw_ai_output.meta.stop_reason)).toEqual(['max_tokens', 'max_tokens']);
  });

  it('output tidak lolos skema → failed `unsupported`, JSON mentah tersimpan', async () => {
    const { captureId } = await submitFixture(env, 'struk-aeon');
    const res = await processNextCapture(depsWith(new FakeClaude(fakeMessage({ json: { ...llmStrukAeon(), lines: null } }))));
    expect(res).toMatchObject({ captureId, status: 'failed' });
    expect(await captureRow(env, captureId)).toMatchObject({ error_code: 'unsupported' });
    const [run] = await runRow(captureId);
    expect(run.raw_ai_output.llm.lines).toBeNull();
  });

  it('bukan struk menurut model → failed `not_a_receipt`, transkripsi tersimpan', async () => {
    const notReceipt = { ...llmStrukAeon(), document: { type: 'price_label' as const, readable: true, reason: null }, transcript: 'LABEL RAK' };
    const { captureId } = await submitFixture(env, 'struk-aeon');
    await processNextCapture(depsWith(new FakeClaude(fakeMessage({ json: notReceipt }))));
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'failed', error_code: 'not_a_receipt' });
    const [run] = await runRow(captureId);
    expect(run.raw_ocr_text).toBe('LABEL RAK');
    expect(run.raw_ai_output.llm.document.type).toBe('price_label');
  });
});

describe('gagal sebelum panggilan', () => {
  it('gambar tidak bisa didekode → failed `unsupported` tanpa memanggil Claude', async () => {
    const fake = new FakeClaude();
    const { captureId } = await uploadAndSubmit({ pool: env.admin, blob: env.blob, userId: USERS.a, kind: 'receipt', images: [Buffer.from('bukan gambar')] });
    expect(await processNextCapture(depsWith(fake))).toMatchObject({ captureId, status: 'failed' });
    expect(await captureRow(env, captureId)).toMatchObject({
      error_code: 'unsupported',
      error_message: 'Gambar tidak bisa dibuka. Coba foto ulang atau pilih foto lain.',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('API 429 → sementara, diulang pipeline', async () => {
    const { captureId } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(depsWith(new FakeClaude(apiError.rateLimit())))).toMatchObject({ captureId, status: 'uploaded' });
    const [run] = await runRow(captureId);
    expect(run.raw_ai_output).toBeNull();
    await skipBackoff(env, captureId);
    expect(await processNextCapture(depsWith(new FakeClaude(fakeMessage({ json: llmStrukAeon() }))))).toMatchObject({
      captureId,
      attempt: 2,
      status: 'needs_confirmation',
    });
  });

  it('tenggat lease sudah lewat (lease ≤ 30 dtk) → signal aborted, sementara', async () => {
    const fake = new FakeClaude(async (_p, signal) => {
      if (signal?.aborted) throw apiError.abort();
      return fakeMessage({ json: llmStrukAeon() });
    });
    const { captureId } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(depsWith(fake, { leaseSeconds: 30 }))).toMatchObject({ captureId, status: 'uploaded' });
    expect(fake.calls[0]!.signal!.aborted).toBe(true);
  });
});
