// Uji live Tanya (docs/08 §13.2 baris Live, §13.3): set pertanyaan emas terhadap Claude sungguhan.
//   LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/web test:live-ask
// Opsional: ASK_MODEL=claude-sonnet-5-5 (membandingkan model, Q-115), GOLDEN_IDS=1,5,25 (sebagian).
// MANUAL, tidak di CI (memanggil API berbayar: ±30 pertanyaan × ±US$0,05). Butuh PostgreSQL lokal
// (PG* env) seperti test L3. Laporan agregat (tanpa teks jawaban) ditulis ke
// .data/ask-golden/<waktu>.json (folder .data di-gitignore) dan ringkasan dicetak.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgRpcClient, REPO_ROOT, USERS, buildTestDb, householdOf, newPool } from '@priceatlas/testkit';
import { AskError, createAskClaudeClient, runAsk, type AskOutcome } from '@priceatlas/ai-tools/ask';
import { askEngineFromEnv } from '@/lib/ask/server';
import { GOLDEN_QUESTIONS, grade, seedGolden, summarize, type GoldenResult } from './ask-golden';

const engine = askEngineFromEnv();
const live = process.env.LIVE_AI === '1' && engine.mode === 'claude';
const ids = process.env.GOLDEN_IDS?.split(',').map(Number);

let pool: pg.Pool;
let ani: PgRpcClient;

describe.skipIf(!live)('set pertanyaan emas Tanya (LIVE_AI=1)', () => {
  beforeAll(async () => {
    pool = newPool(buildTestDb('priceatlas_live_ask'));
    ani = new PgRpcClient(pool, USERS.a);
    await seedGolden(pool, await householdOf(pool, USERS.a));
  });
  afterAll(async () => {
    await pool?.end();
  });

  it(
    '30 pertanyaan: 100 % menolak di luar kemampuan, ≥ 90 % tool benar',
    async () => {
      if (engine.mode !== 'claude') return;
      const claude = createAskClaudeClient(engine.apiKey);
      const before = (await pool.query<{ n: number }>('select count(*)::int as n from public.price_record')).rows[0]!.n;
      const today = (await pool.query<{ d: string }>(`select to_char(current_date, 'YYYY-MM-DD') as d`)).rows[0]!.d;
      const results: GoldenResult[] = [];
      for (const g of GOLDEN_QUESTIONS.filter((x) => !ids || ids.includes(x.id))) {
        const t0 = Date.now();
        let o: AskOutcome | null = null;
        let err: string | undefined;
        try {
          o = await runAsk({ claude, model: engine.model, rpc: ani, question: g.question, today });
        } catch (e) {
          err = e instanceof AskError ? e.reason : String(e);
        }
        const r = grade(g, o, Date.now() - t0, err);
        results.push(r);
        console.log(
          `#${g.id} ${g.category}: ${r.kind}${r.kindOk ? '' : ' ✗kind'} [${r.tools.join(',')}]${r.toolOk ? '' : ' ✗tool'}` +
            `${r.numbersOk ? '' : ' ✗angka'}${r.screenOk === false ? ' ✗layar' : ''}${r.forbidOk ? '' : ' ✗injeksi'} ${r.ms} ms`,
        );
      }
      const summary = summarize(results);
      const after = (await pool.query<{ n: number }>('select count(*)::int as n from public.price_record')).rows[0]!.n;
      const report = { at: new Date().toISOString(), model: engine.model, summary, results };
      const dir = resolve(REPO_ROOT, '.data/ask-golden');
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, `${report.at.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify(summary, null, 2));

      expect(after, 'Tanya tidak pernah menulis data').toBe(before);
      if (!ids) {
        expect(summary.outOfScopeRejected, 'menolak di luar kemampuan').toBe(summary.outOfScopeTotal);
        expect(summary.toolCorrect / summary.toolTotal, 'tool benar').toBeGreaterThanOrEqual(0.9);
      }
    },
    30 * 60_000,
  );
});
