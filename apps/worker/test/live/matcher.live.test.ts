// Uji live matcher AI tier 4 (docs/08 §7.3, §13.2 baris Live): ClaudeAiMatcher SUNGGUHAN dengan katalog
// kecil sintetis (daftar pendek disuntikkan, tanpa database). Manual, tidak di CI:
//   LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/worker test:live
//   LIVE_MODEL=claude-opus-5-5 (opsional)
// Biaya ±US$0,03 (satu panggilan, effort low).
import { describe, expect, it } from 'vitest';
import { createClaudeClient } from '../../src/ai/claude.ts';
import type { Db } from '../../src/db.ts';
import { ClaudeAiMatcher, type ShortlistCandidate } from '../../src/extractors/ai-matcher.ts';
import type { UnmatchedItem } from '../../src/pipeline/types.ts';

const LIVE = process.env.LIVE_AI === '1' && !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LIVE_MODEL || 'claude-opus-5-5';

const c = (id: string, brand: string, name: string, size: string, sale_mode: 'unit' | 'weight' = 'unit'): ShortlistCandidate => ({
  product_id: id, brand, name, variant: null, size, sale_mode, category: null, similarity: 0.3,
});
const MILO_500 = c('p-milo-500', 'Nestle', 'Milo Original', '500 g');
const MILO_1KG = c('p-milo-1kg', 'Nestle', 'Milo Original', '1 kg');
const INDOMIE_1 = c('p-indomie-1', 'Indofood', 'Indomie Goreng', '85 g');
const INDOMIE_5 = c('p-indomie-5', 'Indofood', 'Indomie Goreng', '5 × 85 g');
const KOPI = c('p-kopi', 'Kapal Api', 'Kopi Special Mix', '10 × 25 g');

/** Db palsu: daftar pendek tetap per key (urutan sama dengan app.ai_match_shortlist). */
function fakeDb(lists: Record<number, ShortlistCandidate[]>): Db {
  return {
    query: async () => ({
      rows: [{ r: Object.entries(lists).map(([key, candidates]) => ({ key: Number(key), candidates })), max: '0.85' }],
    }),
  } as unknown as Db;
}

describe.skipIf(!LIVE)(`live: ClaudeAiMatcher ${MODEL} dengan katalog kecil`, () => {
  it('memilih ukuran yang benar, null jika tidak ada yang sama, confidence ≤ 0,85', async () => {
    const items: UnmatchedItem[] = [
      { key: 1, raw_text: 'MILO ACTIV-GO 1KG', amount: 152000, quantity: 1 },
      { key: 2, raw_text: 'INDOMIE GRG 5X85G', amount: 15500, quantity: 1 },
      { key: 3, raw_text: 'SABUN CUCI PIRING 750ML', amount: 18900, quantity: 1 },
    ];
    const db = fakeDb({ 1: [MILO_500, MILO_1KG], 2: [INDOMIE_1, INDOMIE_5], 3: [KOPI] });
    const usage: unknown[] = [];
    const matcher = new ClaudeAiMatcher(db, createClaudeClient({ apiKey: process.env.ANTHROPIC_API_KEY }), { model: MODEL });
    const out = await matcher.match(items, {
      householdId: 'h', storeId: 's', storeName: 'Alfamart', kind: 'receipt', imageSha256s: [], onUsage: (u) => usage.push(u),
    });
    console.log(JSON.stringify({ out, usage }));
    const byKey = new Map(out.map((s) => [s.key, s]));
    expect(byKey.get(1)?.product_id).toBe('p-milo-1kg');
    expect(byKey.get(2)?.product_id).toBe('p-indomie-5');
    expect(byKey.has(3)).toBe(false);
    for (const s of out) expect(s.confidence).toBeLessThanOrEqual(0.85);
    expect(usage).toHaveLength(1);
  });
});
