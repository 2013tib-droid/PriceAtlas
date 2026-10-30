// L2/L3 (docs/08 §7, §12.3, §13.2): matcher AI tier 4 dengan klien Claude palsu dan daftar pendek dari
// database, matching screenshot nama produk → judul listing (Q-133), anggaran harian sebelum claim,
// dan batas lease worker. ClaudeAiMatcher belum dipasang ke buildDeps (M2); EXTRACTOR tetap `stub`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from '@priceatlas/testkit';
import type { MatchResult } from '@priceatlas/contracts';
import { ClaudeAiMatcher, buildMatchMessage, mapMatches, type ShortlistCandidate } from '../src/extractors/ai-matcher.ts';
import {
  BudgetGate,
  checkLeaseSeconds,
  parsePositiveEnv,
  pickMatch,
  processNextCapture,
  type PipelineDeps,
} from '../src/pipeline/process-capture.ts';
import type { MatchContext, UnmatchedItem } from '../src/pipeline/types.ts';
import { FakeClaude, apiError, fakeMessage } from './claude-fake.ts';
import { captureRow, logs, setupEnv, submitFixture, type Env } from './helpers.ts';

let env: Env;
const KERIPIK = '7a000000-0000-0000-0000-00000000c001';
const ALFAMART = '20000000-0000-0000-0000-000000000002';
const SHOPEE = '20000000-0000-0000-0000-000000000004';
const MILO_200 = '70000000-0000-0000-0000-000000000200';
const MILO_500 = '70000000-0000-0000-0000-000000000500';

beforeAll(async () => {
  env = setupEnv('priceatlas_l3_matcher', 'w-matcher');
  // Produk privat Ani yang mirip "SNACK XYZ" (similarity 0,4: di bawah tier 3, di atas daftar pendek).
  const hh = await env.admin.query<{ id: string }>('select household_id as id from public.household_member where user_id = $1', [USERS.a]);
  await env.admin.query(
    `insert into public.product (id, household_id, name, variant, content_size, content_unit) values ($1, $2, 'Keripik XYZ', 'Pedas', 70, 'g')`,
    [KERIPIK, hh.rows[0]!.id],
  );
});
afterAll(async () => {
  await env.close();
});

const MODEL = 'claude-opus-5-5';
const matcher = (fake: FakeClaude) => new ClaudeAiMatcher(env.workerDb, fake, { model: MODEL });
const reply = (matches: unknown[], usage = { input_tokens: 2000, output_tokens: 300 }) =>
  fakeMessage({ json: { matches }, usage });

function cand(id: string, sim = 0.4): ShortlistCandidate {
  return { product_id: id, brand: null, name: `Produk ${id.slice(-3)}`, variant: null, size: '1 kg', sale_mode: 'unit', category: null, similarity: sim };
}

describe('mapMatches (L2)', () => {
  const sent: UnmatchedItem[] = [{ key: 5, raw_text: 'A' }, { key: 9, raw_text: 'B' }];
  const lists = new Map([[5, [cand('p1'), cand('p2')]], [9, [cand('p3')]]]);

  it('indeks lokal → product_id; confidence dibatasi ai_match_max_confidence', () => {
    const out = mapMatches({ matches: [{ item: 1, choice: 2, confidence: 0.97, reason: 'x' }, { item: 2, choice: 1, confidence: 0.4, reason: 'y' }] }, sent, lists, 0.85);
    expect(out).toEqual([{ key: 5, product_id: 'p2', confidence: 0.85 }, { key: 9, product_id: 'p3', confidence: 0.4 }]);
  });

  it('pilihan/item di luar daftar pendek, null, duplikat, dan angka liar dibuang', () => {
    const out = mapMatches(
      {
        matches: [
          { item: 1, choice: 3, confidence: 0.9, reason: '' },   // di luar daftar item 1
          { item: 1, choice: 0, confidence: 0.9, reason: '' },
          { item: 3, choice: 1, confidence: 0.9, reason: '' },   // item tidak ada
          { item: 2, choice: null, confidence: 0.9, reason: '' },
          { item: 1.5, choice: 1, confidence: 0.9, reason: '' },
          { item: 1, choice: 1, confidence: -2, reason: '' },    // confidence → 0
          { item: 1, choice: 2, confidence: 0.9, reason: '' },   // duplikat: yang pertama menang
        ],
      },
      sent,
      lists,
      0.85,
    );
    expect(out).toEqual([{ key: 5, product_id: 'p1', confidence: 0 }]);
  });

  it('pesan ke model tanpa UUID: indeks lokal, ukuran, nominal, nama toko', () => {
    const ctx: MatchContext = { householdId: 'h', storeId: 's', storeName: 'Alfamart', kind: 'receipt', imageSha256s: [] };
    const msg = buildMatchMessage([{ key: 5, raw_text: 'MILO 1KG', amount: 150000, quantity: 1 }], new Map([[5, [cand(MILO_500)]]]), ctx);
    expect(msg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(JSON.parse(msg)).toEqual({
      store: 'Alfamart',
      source: 'receipt',
      items: [{ item: 1, text: 'MILO 1KG', title: null, amount: 150000, quantity: 1,
                candidates: [{ choice: 1, brand: null, name: 'Produk 500', variant: null, size: '1 kg', sale_mode: 'unit', category: null }] }],
    });
  });
});

describe('ClaudeAiMatcher + database (L3)', () => {
  const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
    householdId: '', storeId: ALFAMART, storeName: 'Alfamart', kind: 'receipt', imageSha256s: [], ...over,
  });
  const hhOf = async (user: string) =>
    (await env.admin.query<{ id: string }>('select household_id as id from public.household_member where user_id = $1', [user])).rows[0]!.id;

  it('daftar pendek dari app.ai_match_shortlist; satu panggilan effort low, max_tokens 2000; biaya dilaporkan', async () => {
    const fake = new FakeClaude(reply([{ item: 1, choice: 1, confidence: 0.9, reason: 'sama' }]));
    const usage: unknown[] = [];
    const out = await matcher(fake).match(
      [{ key: 5, raw_text: 'SNACK XYZ', amount: 12000, quantity: 1 }],
      ctx({ householdId: await hhOf(USERS.a), onUsage: (u) => usage.push(u) }),
    );
    expect(out).toEqual([{ key: 5, product_id: KERIPIK, confidence: 0.85 }]);
    expect(fake.calls).toHaveLength(1);
    const p = fake.calls[0]!.params;
    expect(p).toMatchObject({ model: MODEL, max_tokens: 2000, output_config: { effort: 'low' } });
    const text = (p.messages[0]!.content as { text: string }[])[0]!.text;
    expect(text).toContain('Keripik XYZ');
    expect(text).not.toContain(KERIPIK);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ inputTokens: 2000, outputTokens: 300 });
  });

  it('household lain / tanpa daftar pendek → tidak ada panggilan (tanpa biaya)', async () => {
    const fake = new FakeClaude();
    const out = await matcher(fake).match([{ key: 5, raw_text: 'SNACK XYZ' }], ctx({ householdId: await hhOf(USERS.b) }));
    expect(out).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it('error API atau output tidak valid → [] tanpa melempar, biaya respons tetap dilaporkan', async () => {
    const hh = await hhOf(USERS.a);
    expect(await matcher(new FakeClaude(apiError.server())).match([{ key: 5, raw_text: 'SNACK XYZ' }], ctx({ householdId: hh }))).toEqual([]);
    const usage: unknown[] = [];
    const bad = new FakeClaude(fakeMessage({ text: 'bukan json' }));
    expect(await matcher(bad).match([{ key: 5, raw_text: 'SNACK XYZ' }], ctx({ householdId: hh, onUsage: (u) => usage.push(u) }))).toEqual([]);
    expect(usage).toHaveLength(1);
    expect(logs.filter((l) => l.includes('"ai.match_failed"')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('pipeline dengan tier 4 (L3)', () => {
  it('struk-aeon: baris tanpa kandidat → saran AI (≤ 0,85, dikonfirmasi), biaya tier 4 masuk run', async () => {
    const fake = new FakeClaude(reply([{ item: 1, choice: 1, confidence: 0.95, reason: 'sama' }], { input_tokens: 1000, output_tokens: 200 }));
    const deps: PipelineDeps = { ...env.deps, ai: matcher(fake) };
    const { captureId } = await submitFixture(env, 'struk-aeon');
    const res = await processNextCapture(deps);
    expect(res).toMatchObject({ captureId, status: 'needs_confirmation' });

    // Hanya baris 5 (SNACK XYZ) yang dikirim: MILO dan INDOMIE sudah punya kandidat tier 1–3.
    const msg = JSON.parse((fake.calls[0]!.params.messages[0]!.content as { text: string }[])[0]!.text);
    expect(msg.items.map((i: { text: string }) => i.text)).toEqual(['SNACK XYZ']);
    expect(msg.items[0]).toMatchObject({ amount: 12000 });
    expect(msg.store).toBe('AEON');
    expect(fake.calls[0]!.signal).toBeInstanceOf(AbortSignal);

    const line = await env.admin.query(
      `select l.suggested_product_id, l.match_tier, l.match_confidence from public.receipt_line l
         join public.receipt r on r.id = l.receipt_id where r.capture_id = $1 and l.line_no = 5`,
      [captureId],
    );
    expect(line.rows[0]).toMatchObject({ suggested_product_id: KERIPIK, match_tier: 'ai' });
    expect(Number(line.rows[0].match_confidence)).toBe(0.85);
    const run = await env.admin.query('select input_tokens, output_tokens, cost_usd, raw_ai_output from public.processing_run where capture_id = $1', [captureId]);
    expect(run.rows[0]).toMatchObject({ input_tokens: 1000, output_tokens: 200 });
    expect(Number(run.rows[0].cost_usd)).toBeGreaterThan(0);
    expect(run.rows[0].raw_ai_output).toMatchObject({ kind: 'receipt' });
  });

  it('Q-133 screenshot: alias dari judul listing menang atas fuzzy nama produk; kandidat digabung', async () => {
    const hh = (await env.admin.query<{ id: string }>('select household_id as id from public.household_member where user_id = $1', [USERS.a])).rows[0]!.id;
    await env.admin.query(
      `insert into public.product_alias (household_id, store_id, product_id, alias_text) values ($1, $2, $3, 'Milo Original 500 g Nestle')`,
      [hh, SHOPEE, MILO_200],
    );
    const fake = new FakeClaude();
    const { captureId } = await submitFixture(env, 'shopee-milo');
    await processNextCapture({ ...env.deps, ai: matcher(fake) });
    expect(fake.calls).toHaveLength(0);
    const it = await env.admin.query(
      'select suggested_product_id, match_tier, match_confidence, candidate_product_ids from public.capture_item where capture_id = $1',
      [captureId],
    );
    expect(it.rows[0]).toMatchObject({ suggested_product_id: MILO_200, match_tier: 'alias' });
    expect(Number(it.rows[0].match_confidence)).toBe(0.98);
    expect(it.rows[0].candidate_product_ids).toContain(MILO_500);
  });
});

describe('pickMatch (Q-133, L2)', () => {
  const r = (tier: MatchResult['tier'], confidence: number, ids: string[]): MatchResult => ({
    product_id: ids[0] ?? null, tier, confidence, candidates: ids.map((id) => ({ product_id: id, tier: tier!, confidence })),
  });
  it('tanpa judul atau judul tanpa kandidat → hasil nama produk', () => {
    const p = r('fuzzy', 0.6, ['a']);
    expect(pickMatch(p, undefined)).toBe(p);
    expect(pickMatch(p, r(null, 0, []))).toBe(p);
    expect(pickMatch(undefined, undefined)).toBeUndefined();
  });
  it('nama produk tanpa kandidat → judul', () => {
    const t = r('fuzzy', 0.55, ['b']);
    expect(pickMatch(r(null, 0, []), t)).toBe(t);
  });
  it('tier lebih kuat menang, lalu confidence; seri → nama produk; kandidat digabung maks 5', () => {
    expect(pickMatch(r('fuzzy', 0.9, ['a', 'c']), r('alias', 0.95, ['b', 'a']))).toMatchObject({ product_id: 'b', tier: 'alias', candidates: [{ product_id: 'b' }, { product_id: 'a' }, { product_id: 'c' }] });
    expect(pickMatch(r('fuzzy', 0.6, ['a']), r('fuzzy', 0.7, ['b']))!.product_id).toBe('b');
    expect(pickMatch(r('fuzzy', 0.7, ['a']), r('fuzzy', 0.7, ['b']))!.product_id).toBe('a');
    expect(pickMatch(r('fuzzy', 0.7, ['a', 'b', 'c', 'd', 'e']), r('fuzzy', 0.6, ['f']))!.candidates).toHaveLength(5);
  });
});

describe('anggaran harian dan lease (§12.3, §5.4)', () => {
  it('biaya hari ini ≥ anggaran → tidak claim, capture tetap uploaded; log maks sekali per jam', async () => {
    const { captureId } = await submitFixture(env, 'label-milo');
    let now = 1_000_000;
    const gate = new BudgetGate(env.workerDb, 0.000001, () => now);
    await env.admin.query(
      `update public.processing_run set cost_usd = 0.01 where id = (select id from public.processing_run order by started_at desc limit 1)`,
    );
    const before = logs.filter((l) => l.includes('"ai.budget_exhausted"')).length;
    expect(await processNextCapture({ ...env.deps, budget: gate })).toBeNull();
    expect(await processNextCapture({ ...env.deps, budget: gate })).toBeNull();
    expect((await captureRow(env, captureId)).status).toBe('uploaded');
    expect(logs.filter((l) => l.includes('"ai.budget_exhausted"')).length - before).toBe(1);
    now += 3_600_000;
    expect(await gate.allow()).toBe(false);
    expect(logs.filter((l) => l.includes('"ai.budget_exhausted"')).length - before).toBe(2);

    // Tanpa override: app.config ai_daily_budget_usd (2,00) → masih di bawah anggaran.
    expect(await new BudgetGate(env.workerDb).allow()).toBe(true);
    expect(await processNextCapture({ ...env.deps, budget: new BudgetGate(env.workerDb) })).toMatchObject({ captureId });
  });

  it('CAPTURE_LEASE_SECONDS: ≤ capture_processing_timeout_seconds dan > margin tenggat', async () => {
    await expect(checkLeaseSeconds(env.workerDb, 300)).resolves.toBeUndefined();
    await expect(checkLeaseSeconds(env.workerDb, 301)).rejects.toThrow(/capture_processing_timeout_seconds=300/);
    await expect(checkLeaseSeconds(env.workerDb, 30)).rejects.toThrow(/margin/);
    expect(parsePositiveEnv('X', undefined)).toBeNull();
    expect(parsePositiveEnv('X', '240', { integer: true })).toBe(240);
    expect(() => parsePositiveEnv('X', '2.5', { integer: true })).toThrow(/bulat/);
    expect(() => parsePositiveEnv('X', '-1')).toThrow();
    expect(parsePositiveEnv('AI_DAILY_BUDGET_USD', '0.5')).toBe(0.5);
  });
});
