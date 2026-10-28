// Uji live sintetis (docs/08 §13.2 baris Live, §14 M1): VisionExtractor SUNGGUHAN (Claude API) pada set
// sintetis dari generator `eval/synthetic` (3 struk + 2 label + 1 screenshot). Manual, tidak di CI:
//   LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/worker test:live
//   SYNTHETIC_DIR=…   set dari `pnpm --filter @priceatlas/worker synthetic --out DIR` (default:
//                     .data/ocr-eval-synthetic; jika tidak ada, salinan fixture yang di-commit = keluaran
//                     generator yang sama)
//   LIVE_MODEL=claude-opus-5-5  LIVE_EFFORT=medium (opsional)
// Biaya ±US$0,40 dengan Opus 5.5 (7 panggilan). Ringkasan (token, biaya, latensi; tanpa teks) →
// .data/live/<waktu>.json. Tier 4 (matcher AI) belum ada (M3), jadi tidak diuji di sini.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ParsedOutputSchema, type ParsedObservation, type ParsedReceipt } from '@priceatlas/contracts';
import { callStructured, createClaudeClient, type Effort } from '../../src/ai/claude.ts';
import { llmSchemaFor } from '../../src/extractors/llm-schema.ts';
import { systemPrompt } from '../../src/extractors/prompts/index.ts';
import { VisionExtractor } from '../../src/extractors/vision.ts';
import { prepareImages } from '../../src/images/prepare.ts';
import { PermanentError } from '../../src/pipeline/types.ts';
import { REPO_ROOT, writeJson } from '../../eval/data.ts';
import { writeSyntheticSet, type SyntheticTruthFile } from '../../eval/synthetic/set.ts';

const LIVE = process.env.LIVE_AI === '1' && !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LIVE_MODEL || 'claude-opus-5-5';
const EFFORT = (process.env.LIVE_EFFORT || 'medium') as Effort;
const CASES = ['struk-aeon', 'struk-alfamart-timeout', 'struk-tanpa-toko', 'label-milo', 'label-indomie', 'shopee-milo'];

function setDir(): string {
  const d = process.env.SYNTHETIC_DIR || join(REPO_ROOT, '.data/ocr-eval-synthetic');
  if (existsSync(join(d, 'struk-aeon.truth.json'))) return d;
  const tmp = mkdtempSync(join(tmpdir(), 'pa-live-'));
  writeSyntheticSet(tmp);
  return tmp;
}

const summary: { name: string; ok: boolean; served_model?: string; input_tokens?: number | null; output_tokens?: number | null; cost_usd?: number | null; latency_ms: number }[] = [];

describe.skipIf(!LIVE)(`live: VisionExtractor ${MODEL} pada set sintetis`, () => {
  const dir = LIVE ? setDir() : '';
  const client = LIVE ? createClaudeClient({ apiKey: process.env.ANTHROPIC_API_KEY }) : (null as never);
  const extractor = LIVE ? new VisionExtractor(client, { model: MODEL, effortReceipt: EFFORT, effortObservation: EFFORT }) : (null as never);

  afterAll(() => {
    if (!summary.length) return;
    const out = join(REPO_ROOT, '.data/live', `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}.json`);
    writeJson(out, { model: MODEL, effort: EFFORT, cases: summary, total_cost_usd: summary.reduce((s, c) => s + (c.cost_usd ?? 0), 0) });
    console.log(`ringkasan live → ${out}`);
  });

  for (const name of CASES) {
    it(`${name}: lolos kontrak, nominal benar`, async () => {
      const truth = JSON.parse(readFileSync(join(dir, `${name}.truth.json`), 'utf8')) as SyntheticTruthFile;
      const data = readFileSync(join(dir, truth.images[0]!));
      const images = [{ position: 1, storagePath: name, sha256: createHash('sha256').update(data).digest('hex'), data }];
      const t0 = performance.now();
      const prepared = await prepareImages(images);
      const ex = await extractor.extract({
        kind: truth.kind,
        images: images.map((i, k) => ({ ...i, prepared: prepared[k] })),
        // Tanggal unggah dekat tanggal struk sintetis (Oktober 2026), supaya cek jendela tanggal netral.
        ctx: { captureId: name, householdId: 'live', attempt: 1, uploadedAt: new Date('2026-10-16T05:00:00Z'), capturedAt: null },
      });
      const meta = (ex.rawOutput as { meta: { served_model: string } }).meta;
      summary.push({ name, ok: true, served_model: meta.served_model, input_tokens: ex.usage?.inputTokens, output_tokens: ex.usage?.outputTokens, cost_usd: ex.usage?.costUsd, latency_ms: Math.round(performance.now() - t0) });
      expect(ParsedOutputSchema.safeParse(ex.output).success).toBe(true);
      const exp = truth.expected as ParsedReceipt | ParsedObservation;
      if (exp.kind === 'receipt') {
        const out = ex.output as ParsedReceipt;
        const amounts = (r: ParsedReceipt) => r.lines.filter((l) => l.line_type === 'product').map((l) => l.line_amount).sort((a, b) => a - b);
        expect(amounts(out)).toEqual(amounts(exp));
        expect(out.header.total_amount).toBe(exp.header.total_amount);
        expect(out.header.transaction_date).toBe(exp.header.transaction_date);
        // Transkripsi tanpa PII yang tercetak (§9 lapis 1).
        for (const v of truth.annotations.transcript_pii) expect(ex.rawText ?? '').not.toContain(v);
      } else {
        const out = ex.output as ParsedObservation;
        const prices = (o: ParsedObservation) => o.items.map((i) => [i.normal_price ?? null, i.promo_price ?? null, i.member_price ?? null]).sort();
        expect(prices(out)).toEqual(prices(exp));
      }
    });
  }

  it('gambar rusak yang lolos ke API → 400 dikenali sebagai gambar (unsupported), bukan konfigurasi (F-131)', async () => {
    const t0 = performance.now();
    const err = await callStructured(client, {
      model: MODEL, effort: 'low', system: systemPrompt('receipt'), schema: llmSchemaFor('receipt'), maxTokens: 1000, attempt: 1,
      content: [{ type: 'text', text: 'Jenis: struk.' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('bukan jpeg').toString('base64') } }],
    }).catch((e: unknown) => e);
    summary.push({ name: 'gambar-rusak', ok: err instanceof PermanentError, latency_ms: Math.round(performance.now() - t0) });
    expect(err).toBeInstanceOf(PermanentError);
    expect(err).toMatchObject({ code: 'unsupported' });
  });
});

describe.skipIf(LIVE)('live dilewati', () => {
  it('butuh LIVE_AI=1 dan ANTHROPIC_API_KEY (manual, docs/06 §2.9)', () => {
    expect(LIVE).toBe(false);
  });
});
