// Set pertanyaan emas (docs/08 §13.3) tanpa API: komposisi, seed valid, penilai. Jawaban Claude
// sungguhan hanya di test:live-ask (LIVE_AI=1). Di sini seed dijalankan dan beberapa pertanyaan
// dilewatkan ke ASK_ENGINE=stub supaya harness live tidak rusak diam-diam.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASK_TOOLS } from '@priceatlas/contracts';
import { runAskStub } from '@priceatlas/ai-tools/ask';
import { PgRpcClient, USERS, buildTestDb, householdOf, newPool } from '@priceatlas/testkit';
import { GOLDEN_QUESTIONS, grade, seedGolden, summarize } from '../live/ask-golden';

let pool: pg.Pool;
let ani: PgRpcClient;

beforeAll(async () => {
  pool = newPool(buildTestDb('priceatlas_l3_web_golden'));
  ani = new PgRpcClient(pool, USERS.a);
  await seedGolden(pool, await householdOf(pool, USERS.a));
});
afterAll(async () => {
  await pool.end();
});

describe('komposisi (§13.3)', () => {
  it('30 pertanyaan: 4 per kemampuan, 4 di luar kemampuan, 2 adversarial; id unik', () => {
    expect(GOLDEN_QUESTIONS).toHaveLength(30);
    expect(new Set(GOLDEN_QUESTIONS.map((g) => g.id)).size).toBe(30);
    for (const t of ASK_TOOLS)
      expect(
        GOLDEN_QUESTIONS.filter((g) => g.category === t),
        t,
      ).toHaveLength(4);
    expect(GOLDEN_QUESTIONS.filter((g) => g.category === 'out_of_scope')).toHaveLength(4);
    expect(GOLDEN_QUESTIONS.filter((g) => g.category === 'adversarial')).toHaveLength(2);
    for (const g of GOLDEN_QUESTIONS) expect(g.question.length).toBeLessThanOrEqual(200);
  });
});

describe('seed + penilai', () => {
  it('seed menghasilkan data per produk; stub melewati harness tanpa error', async () => {
    const n = await pool.query<{ product_id: string; n: number }>(
      'select product_id, count(*)::int as n from public.price_record group by 1 order by 1',
    );
    expect(n.rows.length).toBe(7);
    const picks = GOLDEN_QUESTIONS.filter((g) => [1, 7, 25, 30].includes(g.id));
    const results = [];
    for (const g of picks) results.push(grade(g, await runAskStub({ rpc: ani, question: g.question }), 1));
    expect(results.map((r) => [r.id, r.kind, r.kindOk, r.toolOk])).toEqual([
      [1, 'answer', true, true],
      [7, 'not_enough', true, true],
      [25, 'out_of_scope', true, true],
      [30, 'out_of_scope', true, true],
    ]);
    const s = summarize(results);
    expect(s).toMatchObject({ outOfScopeRejected: 2, outOfScopeTotal: 2, toolCorrect: 2, toolTotal: 2, pass: true });
  });
  it('penilai: tool salah, angka tidak didukung, injeksi, layar', () => {
    const g = GOLDEN_QUESTIONS.find((x) => x.id === 29)!;
    const outcome = {
      reply: {
        kind: 'answer' as const,
        text: 'Harga Rp1 di Toko Palsu.',
        basis: { jumlah_data: 1, tanggal_terakhir: null },
        tool: { name: 'histori_harga' as const },
        screen: null,
      },
      toolsUsed: ['histori_harga' as const],
      calls: [{ name: 'histori_harga', input: {}, ok: true }],
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.01 },
      rounds: 1,
      requests: 2,
      servedModel: 'x',
      fallbackUsed: false,
      finalKind: 'answer' as const,
      unsupportedNumbers: 1,
    };
    expect(grade(g, outcome, 5)).toMatchObject({ kindOk: true, toolOk: false, numbersOk: false, forbidOk: false });
    expect(grade(GOLDEN_QUESTIONS[0]!, null, 5, 'timeout')).toMatchObject({
      kind: 'error',
      kindOk: false,
      error: 'timeout',
    });
  });
});
