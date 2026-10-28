// Uji live VisionExtractor (docs/08 §13.2, baris "Live (manual)"): 3 struk + 2 label + 1 screenshot
// sintetis lewat Claude sungguhan. Lulus jika output lolos kontrak (ParsedOutputSchema) dan nominal
// benar terhadap ground truth fixture. Dilewati tanpa LIVE_AI=1 + ANTHROPIC_API_KEY (CI tidak pernah
// punya kunci). Tier 4 (ClaudeAiMatcher) menyusul di 6b M3.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParsedOutputSchema, type ParsedOutput } from '@priceatlas/contracts';
import { createClaudeClient } from '../../src/ai/claude.ts';
import { VisionExtractor } from '../../src/extractors/vision.ts';
import { prepareImages } from '../../src/images/prepare.ts';
import type { CaptureKind } from '../../src/pipeline/types.ts';
import { REPO_ROOT } from '../../eval/paths.ts';
import { scoreCapture } from '../../eval/score.ts';
import { SPECS } from '../../eval/synthetic/specs.ts';

const LIVE = process.env.LIVE_AI === '1' && !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.EXTRACT_MODEL || 'claude-opus-5-5';
const CASES = ['struk-aeon', 'struk-alfamart-timeout', 'struk-tanpa-toko', 'label-milo', 'label-kamera', 'shopee-milo'];

describe.skipIf(!LIVE)(`VisionExtractor live (${MODEL})`, () => {
  const extractor = new VisionExtractor(createClaudeClient(), { model: MODEL, effortReceipt: 'medium', effortObservation: 'low' });
  let spent = 0;

  for (const name of CASES) {
    it(name, async () => {
      const spec = SPECS.find((s) => s.name === name)!;
      const dir = join(REPO_ROOT, spec.fixtureDir);
      const expected = ParsedOutputSchema.parse((JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as { output: ParsedOutput }).output);
      const data = readFileSync(join(dir, `${name}.jpg`));
      const images = [{ position: 1, storagePath: name, sha256: '', data }];
      const [prepared] = await prepareImages(images);
      const x = await extractor.extract({
        kind: spec.kind as CaptureKind,
        images: [{ ...images[0]!, prepared }],
        ctx: { captureId: name, householdId: 'live', attempt: 1, uploadedAt: new Date('2026-10-20T03:00:00Z'), capturedAt: null },
      });
      spent += x.usage?.costUsd ?? 0;
      expect(ParsedOutputSchema.safeParse(x.output).success).toBe(true);
      const s = scoreCapture(
        { id: name, kind: spec.kind as CaptureKind, images: [name], split: 'test', store_category: null, conditions: [], expected, annotations: { lines: {}, transcript_pii: [] }, verified: null },
        { id: name, arm: 'live', repeat: 1, mode: 'realtime', ok: true, output: x.output, rawText: x.rawText ?? null, cost_usd: x.usage?.costUsd ?? null, latency_ms: null },
      );
      const key = spec.kind === 'receipt' ? 'lines.amount' : 'obs.price';
      console.log(`${name}: ${key} ${JSON.stringify(s.tally[key])}, biaya US$${x.usage?.costUsd ?? '?'} (kumulatif US$${spent.toFixed(4)})`);
      expect(s.tally[key]![0]).toBe(s.tally[key]![1]);
      if (spec.kind === 'receipt') expect(s.tally['header.total']).toEqual([1, 1]);
      expect(s.tally['pii.leak']?.[0] ?? 0).toBe(0);
    });
  }
});
