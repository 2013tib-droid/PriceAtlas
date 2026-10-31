// L3 (D-100, docs/08 §23): struk tempelan dari Gemini lewat pipeline penuh tanpa AI — W1b →
// claim → TextExtractor → matching tier 1–3 → apply_extraction (S-10), teks rusak → gagal permanen,
// EXTRACTOR=off tidak mengklaim foto.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASTE_CONFIDENCE, TextExtractor, pastedToLlm } from '../src/extractors/text.ts';
import { selectAi } from '../src/extractors/select.ts';
import { processNextCapture, type PipelineDeps } from '../src/pipeline/process-capture.ts';
import { PermanentError } from '../src/pipeline/types.ts';
import { captureRow, setupEnv, submitFixture, type Env } from './helpers.ts';

const UPLOADED = new Date('2026-10-30T08:00:00Z');
const ctx = { captureId: 'c', householdId: 'h', attempt: 1, uploadedAt: UPLOADED, capturedAt: null };

const PASTE = {
  format: 'priceatlas-struk-v1',
  store: { name: 'AEON', branch: 'BSD' },
  date: '2026-10-29',
  time: '19:42',
  total: 88000,
  payment_method: 'debit',
  lines: [
    { type: 'product', text: 'MILO ORI 500G', quantity: 2, unit_price: 45000, amount: 90000 },
    { type: 'discount', text: 'DISC MEMBER', amount: -2000, applies_to: 1, member_discount: true },
    { type: 'non_product', text: 'KANTONG PLASTIK', amount: 0 },
  ],
};
const pasteText = (o: unknown = PASTE) => `Berikut JSON-nya:\n\`\`\`json\n${JSON.stringify(o, null, 2)}\n\`\`\``;

describe('TextExtractor (unit)', () => {
  const x = new TextExtractor();

  it('tempelan → kontrak struk, biaya 0, cek konverter berlaku', () => {
    const e = x.extractText({ kind: 'receipt', text: pasteText(), ctx });
    expect(e.output.kind).toBe('receipt');
    if (e.output.kind !== 'receipt') return;
    expect(e.output.store_hint).toEqual({ name: 'AEON', branch_name: 'BSD' });
    expect(e.output.header).toMatchObject({ transaction_date: '2026-10-29', transaction_time: '19:42', total_amount: 88000, payment_method: 'debit', currency: 'IDR' });
    expect(e.output.lines.map((l) => [l.line_no, l.line_type, l.line_amount, l.applies_to_line_no ?? null])).toEqual([
      [1, 'product', 90000, null],
      [2, 'discount', -2000, 1],
      [3, 'non_product', 0, null],
    ]);
    expect(e.output.lines[1]!.member_discount).toBe(true);
    expect(e.output.lines[0]!.parse_confidence).toBe(PASTE_CONFIDENCE);
    expect(e.output.header.field_confidence.total).toBe(PASTE_CONFIDENCE);
    expect(e.output.pii).toEqual({});
    expect(e.usage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(e.rawText).toBe(pasteText());
  });

  it('total tidak cocok dan aritmetika salah → confidence dibatasi (sama dengan foto)', () => {
    const e = x.extractText({
      kind: 'receipt',
      text: JSON.stringify({ ...PASTE, total: 99999, lines: [{ text: 'MILO', quantity: 2, unit_price: 45000, amount: 80000 }] }),
      ctx,
    });
    if (e.output.kind !== 'receipt') throw new Error('kind');
    expect(e.output.header.field_confidence.total).toBe(0.7);
    expect(e.output.lines[0]!.parse_confidence).toBe(0.6);
    expect((e.rawOutput as { meta: { flags: string[] } }).meta.flags).toEqual(expect.arrayContaining(['total_mismatch', 'arithmetic:line1']));
  });

  it('teks rusak / jenis bukan struk / teks sudah dihapus → PermanentError', () => {
    expect(() => x.extractText({ kind: 'receipt', text: 'Maaf, gambar tidak jelas.', ctx })).toThrow(PermanentError);
    try {
      x.extractText({ kind: 'receipt', text: '{"lines": []}', ctx });
    } catch (e) {
      expect((e as PermanentError).code).toBe('unsupported');
      expect((e as PermanentError).runOutput?.usage?.costUsd).toBe(0);
    }
    expect(() => x.extractText({ kind: 'price_label', text: pasteText(), ctx })).toThrow(/tidak sesuai format/);
    expect(() => x.extractText({ kind: 'receipt', text: null, ctx })).toThrow(/sudah dihapus/);
  });

  it('pastedToLlm: field yang tidak ada di format diisi netral', () => {
    const llm = pastedToLlm({ lines: [{ type: 'product', text: 'A', amount: 1 }] }, 't');
    expect(llm.store).toEqual({ name: null, branch: null, confidence: PASTE_CONFIDENCE });
    expect(llm.lines[0]).toMatchObject({ section: 1, quantity: null, applies_to: null, member_discount: false, bundle: false });
    expect(llm.adjustments).toEqual([]);
    expect(llm.member).toBeNull();
  });
});

let env: Env;
beforeAll(() => {
  env = setupEnv('priceatlas_l3_text', 'w-text');
});
afterAll(async () => {
  await env.close();
});

async function submitText(text: string): Promise<string> {
  const id = randomUUID();
  const r = await env.ani.rpc('submit_text_capture', { p_capture_id: id, p_kind: 'receipt', p_text: text });
  expect(r.error).toBeNull();
  return id;
}

describe('pipeline capture teks (L3)', () => {
  it('tempelan valid → struk menunggu konfirmasi, run engine paste tanpa biaya', async () => {
    const id = await submitText(pasteText());
    const res = await processNextCapture(env.deps);
    expect(res).toMatchObject({ captureId: id, status: 'needs_confirmation' });
    const run = await env.admin.query('select ocr_engine, ai_model, prompt_version, cost_usd, raw_ocr_text, raw_ai_output from public.processing_run where capture_id = $1', [id]);
    expect(run.rows[0]).toMatchObject({ ocr_engine: 'paste', ai_model: null, prompt_version: 'paste-v1' });
    expect(Number(run.rows[0].cost_usd)).toBe(0);
    expect(run.rows[0].raw_ocr_text).toBe(pasteText());
    expect(run.rows[0].raw_ai_output.meta.engine).toBe('paste');
    const rc = await env.admin.query(
      `select r.total_amount, r.transaction_date::text as d, count(l.*) as n
         from public.receipt r join public.receipt_line l on l.receipt_id = r.id
        where r.capture_id = $1 group by r.id`,
      [id],
    );
    expect(rc.rows[0]).toMatchObject({ d: '2026-10-29', n: '3' });
    expect(Number(rc.rows[0].total_amount)).toBe(88000);
  });

  it('tempelan rusak (lolos W1b, gagal parser) → failed unsupported tanpa retry', async () => {
    const id = await submitText('{"lines": [{"text": "A"}]}');
    const res = await processNextCapture(env.deps);
    expect(res).toMatchObject({ captureId: id, status: 'failed' });
    const c = await captureRow(env, id);
    expect(c).toMatchObject({ status: 'failed', error_code: 'unsupported' });
    expect(c.error_message).toMatch(/tidak sesuai format/);
  });

  it('EXTRACTOR=off: foto tetap menunggu di antrean, teks diproses', async () => {
    const sel = selectAi({ EXTRACTOR: 'off', AI_MATCHER: 'off' }, env.workerDb, {
      claude: () => {
        throw new Error('Claude tidak boleh dibuat');
      },
      ocr: () => {
        throw new Error('OCR tidak boleh dibuat');
      },
      stub: () => {
        throw new Error('stub tidak dipakai');
      },
    });
    const deps: PipelineDeps = { ...env.deps, extractor: sel.extractor, ai: sel.ai, sources: sel.sources };
    const photo = await submitFixture(env, 'struk-aeon');
    const text = await submitText(pasteText({ ...PASTE, date: '2026-10-28' }));
    const res = await processNextCapture(deps);
    expect(res).toMatchObject({ captureId: text, status: 'needs_confirmation' });
    expect(await processNextCapture(deps)).toBeNull();
    expect((await captureRow(env, photo.captureId)).status).toBe('uploaded');
  });
});
