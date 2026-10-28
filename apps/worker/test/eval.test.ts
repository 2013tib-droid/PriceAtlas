// L2: harness uji OCR (docs/08 §4, §13.1) — tanpa jaringan, tanpa kunci, hanya data sintetis.
// Folder data test di .data/ (di-ignore git); tidak ada foto/ground truth asli.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedReceipt } from '@priceatlas/contracts';
import { OcrThenParseExtractor, OCR_HINT } from '../src/extractors/ocr-parse.ts';
import { GoogleVisionOcr, parseGcv } from '../src/extractors/ocr/google-vision.ts';
import { prepareImages } from '../src/images/prepare.ts';
import { PermanentError, TransientError } from '../src/pipeline/types.ts';
import { ARMS, resolveArms } from '../eval/arms.ts';
import { createAnnotateServer } from '../eval/annotate/server.ts';
import { main as cli } from '../eval/cli.ts';
import { FakeEvalClient, llmFromTruth } from '../eval/fake.ts';
import { assignSplits } from '../eval/init.ts';
import { REPO_ROOT, UnsafeDataDirError, assertSafeDataDir, evalPaths } from '../eval/paths.ts';
import { buildReport, decide } from '../eval/report.ts';
import { Budget, BudgetExceededError, batchCost } from '../eval/run.ts';
import { alignLines, autoSaveAt, cer, ece, hungarian, instability, scoreCapture, summarize, tauFor, type RunRecord } from '../eval/score.ts';
import { readManifest, readTruth, type Truth } from '../eval/truth.ts';
import { FakeClaude, fakeMessage, llmStrukAeon } from './claude-fake.ts';
import { fixtureImages } from './helpers.ts';

const DATA = join(REPO_ROOT, '.data', `ocr-eval-test-${process.pid}`);
const paths = evalPaths(DATA);
const quiet = () => {};

beforeAll(() => {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
});
afterAll(() => rmSync(DATA, { recursive: true, force: true }));

// ------------------------------------------------------------------ pengaman F-117

describe('pengaman folder data (F-117)', () => {
  it('.data/ di dalam repo (di-ignore) boleh; folder di luar repo boleh', () => {
    expect(() => assertSafeDataDir(DATA)).not.toThrow();
    expect(() => assertSafeDataDir(join(tmpdir(), 'ocr-eval-luar'))).not.toThrow();
  });
  it('folder di dalam repo yang TIDAK di-ignore → ditolak sebelum menulis apa pun', async () => {
    const bad = join(REPO_ROOT, 'apps/worker/eval/data-asli');
    expect(() => assertSafeDataDir(bad)).toThrow(UnsafeDataDirError);
    expect(() => assertSafeDataDir(REPO_ROOT)).toThrow(UnsafeDataDirError);
    await expect(cli(['init', '--synthetic', '--from-fixtures', '--dir', bad], quiet)).rejects.toBeInstanceOf(UnsafeDataDirError);
    expect(existsSync(bad)).toBe(false);
  });
});

// ------------------------------------------------------------------ skor

const line = (no: number, text: string, amount: number, extra: Partial<ParsedReceipt['lines'][number]> = {}) => ({
  line_no: no, line_type: 'product' as const, raw_text: text, line_amount: amount, parse_confidence: 0.95, ...extra,
});

const receiptTruth = (): Truth => ({
  id: 'r-0001', kind: 'receipt', images: ['r-0001-1.jpg'], split: 'test', store_category: 'minimarket', conditions: ['faded'],
  expected: {
    kind: 'receipt',
    store_hint: { name: 'ALFAMART', branch_name: 'SERPONG' },
    header: { transaction_date: '2026-10-14', transaction_time: '08:15', total_amount: 26800, payment_method: 'TUNAI', field_confidence: {} },
    pii: { phone: '081298765432' },
    lines: [
      line(1, 'INDOMIE GRG 85G', 6800, { quantity: 2, unit_amount: 3400 }),
      line(2, 'DISC MEMBER', -1000, { line_type: 'discount', applies_to_line_no: 1 }),
      line(3, 'GULA PASIR 1KG', 16000),
      line(4, 'TELUR AYAM', 5000, { quantity: 0.25, unit_amount: 20000 }),
    ],
    adjustments: [],
  },
  annotations: { lines: { '2': { member_discount: true }, '4': { weighed: true } }, transcript_pii: ['081298765432'] },
  verified: { by: 'owner', at: '2026-11-01', prefill: null },
});

const rec = (output: unknown, extra: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r-0001', arm: 'vision-opus-low', repeat: 1, mode: 'batch', ok: true, output: output as RunRecord['output'], rawText: 'TOTAL 26.800 HP [REDAKSI]', cost_usd: 0.01, latency_ms: null, ...extra,
});

describe('penyelarasan dan metrik (§4.7)', () => {
  it('Hungaria: penugasan biaya minimum, matriks persegi panjang', () => {
    expect(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
    expect(hungarian([[1, 9], [9, 1], [5, 5]])).toEqual([0, 1, -1]);
    expect(hungarian([])).toEqual([]);
  });
  it('baris dipasangkan lewat teks + nominal; teks jauh DAN nominal beda → tidak berpasangan', () => {
    const t = receiptTruth().expected as ParsedReceipt;
    const pred = [line(1, 'GULA PASIR 1 KG', 16000), line(2, 'INDOMIE GRG 85G', 6800), line(3, 'SABUN XYZ', 12345)];
    const pairs = alignLines(t.lines, pred);
    expect(pairs.get(0)).toBe(1);
    expect(pairs.get(2)).toBe(0);
    expect([...pairs.values()]).not.toContain(2);
    expect(cer('GULA PASIR 1 KG', 'GULA PASIR 1KG')).toBeLessThanOrEqual(0.1);
  });
  it('prediksi sempurna → semua metrik benar, struk sempurna, member konverter + regex, timbang, PII tidak bocor', () => {
    const t = receiptTruth();
    const s = scoreCapture(t, rec({ ...t.expected, header: { ...(t.expected as ParsedReceipt).header, payment_method: 'cash', field_confidence: { date: 0.97 } } }));
    for (const k of ['header.store', 'header.branch', 'header.date', 'header.time', 'header.total', 'header.payment', 'lines.recall', 'lines.precision', 'lines.amount', 'lines.discount', 'lines.weighed', 'receipt.perfect', 'receipt.sum_total', 'pii.recall', 'member.regex_recall']) {
      expect(s.tally[k], k).toEqual([s.tally[k]![1], s.tally[k]![1]]);
    }
    expect(s.tally['member.converter_recall']).toEqual([0, 1]); // ground truth tidak menandai member_discount di baris kontrak
    expect(s.tally['pii.leak']).toEqual([0, 1]);
    expect(s.corrections).toBe(0);
    expect(s.conf.every((c) => c.correct)).toBe(true);
  });
  it('nominal salah + baris karangan + PII bocor → koreksi, confidence tidak benar, kebocoran terhitung', () => {
    const t = receiptTruth();
    const exp = t.expected as ParsedReceipt;
    const pred = { ...exp, lines: [{ ...exp.lines[0]!, line_amount: 6900 }, ...exp.lines.slice(1), line(5, 'BARANG HANTU', 999)] };
    const s = scoreCapture(t, rec(pred, { rawText: 'HP 0812 9876 5432' }));
    expect(s.tally['lines.amount']).toEqual([2, 3]);
    expect(s.tally['lines.precision']).toEqual([3, 4]);
    expect(s.tally['receipt.perfect']).toEqual([0, 1]);
    expect(s.corrections).toBe(2);
    expect(s.tally['pii.leak']).toEqual([0, 1]); // HP berspasi tetap tersamar oleh redaksi lapis 2
    const leak = scoreCapture(t, rec(exp, { rawText: 'MEMBER BUDI 081298765432' }));
    expect(leak.tally['pii.leak']).toEqual([0, 1]);
    const leak2 = scoreCapture({ ...t, annotations: { ...t.annotations, transcript_pii: ['BUDI SANTOSO'] } }, rec({ ...exp, pii: {} }, { rawText: 'MEMBER BUDI SANTOSO' }));
    expect(leak2.tally['pii.leak']).toEqual([1, 1]);
  });
  it('kegagalan: refusal/skema dihitung sebagai kegagalan; semua metrik akurasi dihitung salah', () => {
    const t = receiptTruth();
    const s = scoreCapture(t, rec(undefined, { ok: false, error: { code: 'other', message: 'Gambar tidak bisa diproses.', transient: false } }));
    expect(s.tally['ops.failure']).toEqual([1, 1]);
    expect(s.tally['ops.failure.refusal']).toEqual([1, 1]);
    expect(s.tally['lines.recall']).toEqual([0, 3]);
    expect(s.tally['header.total']).toEqual([0, 1]);
    const blurry = scoreCapture({ ...t, expected: null }, rec(undefined, { ok: false, error: { code: 'blurry', message: 'buram', transient: false } }));
    expect(blurry.tally['unreadable.rejected']).toEqual([1, 1]);
  });
  it('baris tak terbaca (anotasi) tidak dinilai', () => {
    const t = receiptTruth();
    t.annotations.lines['3'] = { unreadable: true };
    const s = scoreCapture(t, rec({ ...(t.expected as ParsedReceipt), lines: (t.expected as ParsedReceipt).lines.filter((l) => l.line_no !== 3) }));
    expect(s.tally['lines.recall']).toEqual([2, 2]);
  });
  it('auto-save @τ, τ untuk presisi 98 %, ECE', () => {
    const pts = [...Array.from({ length: 97 }, () => ({ conf: 0.95, correct: true })), { conf: 0.95, correct: false }, { conf: 0.7, correct: false }];
    expect(autoSaveAt(pts, 0.9)).toMatchObject({ precision: 97 / 98, coverage: 98 / 99 });
    expect(tauFor(pts)).toMatchObject({ tau: 0.71 });
    expect(ece([{ conf: 1, correct: true }, { conf: 0, correct: false }])).toBe(0);
    expect(ece([{ conf: 0.9, correct: false }])).toBeCloseTo(0.9);
  });
  it('ketidakstabilan antar-ulangan', () => {
    const t = receiptTruth();
    const a = rec(t.expected);
    const b = rec({ ...(t.expected as ParsedReceipt), header: { ...(t.expected as ParsedReceipt).header, total_amount: 1 } }, { repeat: 2 });
    const [d, n] = instability(a, b);
    expect(d).toBe(1);
    expect(n).toBeGreaterThan(20);
  });
});

describe('kriteria dan usulan §4.8', () => {
  const arm = (name: string, source: string, cost: number, pass: boolean, perfect: number) => ({
    arm: name, model: '', effort: '', source,
    test: { receipt: { ...summarize([]), cost_usd_mean: cost, rates: { 'receipt.perfect': { rate: perfect, hit: 0, total: 0 } } } },
    dev: {}, receipt_by_category: {}, receipt_by_condition: {}, realtime: null,
    criteria: { receipt: [], observation: [], receipt_pass: pass, observation_pass: false },
  });
  it('termurah yang lolos; selisih "struk sempurna" < 1 poin → vision; tidak ada yang lolos → presisi tertinggi', () => {
    expect(decide([arm('a', 'vision', 0.02, true, 0.9), arm('b', 'vision', 0.01, true, 0.8), arm('c', 'vision', 0.001, false, 1)], 'receipt').chosen).toBe('b');
    const d = decide([arm('ocr', 'ocr', 0.005, true, 0.905), arm('v', 'vision', 0.01, true, 0.9)], 'receipt');
    expect(d).toMatchObject({ chosen: 'v', rule: expect.stringContaining('§4.8.3') });
    expect(decide([arm('x', 'vision', 0.01, false, 0.5)], 'receipt')).toMatchObject({ passing: [], rule: expect.stringContaining('§4.8.5') });
  });
});

// ------------------------------------------------------------------ split, biaya, arm

describe('split, biaya, arm', () => {
  it('split dev 30 % berstrata per jenis + kategori, deterministik', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ kind: i < 10 ? 'receipt' : 'price_label', store_category: i % 2 ? 'minimarket' : 'lokal', i }));
    const a = assignSplits(items, 7);
    const b = assignSplits(items, 7);
    expect(a.map((x) => x.split)).toEqual(b.map((x) => x.split));
    for (const kind of ['receipt', 'price_label']) {
      for (const cat of ['minimarket', 'lokal']) {
        const g = a.filter((x) => x.kind === kind && x.store_category === cat);
        expect(g.filter((x) => x.split === 'dev')).toHaveLength(2); // round(5 × 0,3)
      }
    }
  });
  it('batas biaya keras: buku kumulatif, perkiraan yang melewati batas ditolak', () => {
    const b = new Budget(join(DATA, 'spend-test.json'), 1);
    b.reserve(0.5, 'x');
    b.record(0.8, 'run-a');
    expect(() => b.reserve(0.3, 'y')).toThrow(BudgetExceededError);
    expect(new Budget(join(DATA, 'spend-test.json'), 1).spent).toBe(0.8);
    expect(batchCost(0.0115, 0.01)).toBe(0.0065); // diskon 50 % hanya bagian Claude, OCR tetap
  });
  it('lima arm §4.5', () => {
    expect(ARMS.map((a) => a.name)).toEqual(['vision-opus-low', 'vision-opus-medium', 'vision-sonnet', 'vision-haiku', 'ocr-gcv+opus-low']);
    expect(() => resolveArms('vision-gpt')).toThrow(/tidak dikenal/);
  });
});

// ------------------------------------------------------------------ OCR + parse

describe('OcrThenParseExtractor + Google Vision (§5.6)', () => {
  const gcvBody = {
    responses: [
      {
        fullTextAnnotation: {
          text: 'AEON BSD\nMILO ORI 500G 90.000\n',
          pages: [
            {
              width: 1000,
              height: 2000,
              blocks: [
                {
                  paragraphs: [
                    {
                      words: [
                        { symbols: [{ text: 'A' }, { text: 'E' }, { text: 'O' }, { text: 'N', property: { detectedBreak: { type: 'SPACE' } } }], boundingBox: { vertices: [{ x: 100, y: 100 }, { x: 300, y: 140 }] } },
                        { symbols: [{ text: 'B' }, { text: 'S' }, { text: 'D', property: { detectedBreak: { type: 'LINE_BREAK' } } }], boundingBox: { vertices: [{ x: 320, y: 100 }, { x: 420, y: 140 }] } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };
  it('respons GCV → teks + baris berkoordinat (pecahan)', () => {
    const p = parseGcv(gcvBody.responses[0]!, { position: 1, width: 1000, height: 2000 });
    expect(p.lines).toEqual([{ text: 'AEON BSD', box: { x: 0.1, y: 0.05, w: 0.32, h: 0.02 } }]);
  });
  it('error vendor: 429/5xx/jaringan sementara, 400 permanen, 403 konfigurasi (sementara)', async () => {
    const img = (await prepareImages([{ position: 1, storagePath: 'x', sha256: '', data: fixtureImages('label-milo')[0]! }]))[0]!;
    const resp = (status: number, body: unknown = {}) => async () => ({ ok: status < 300, status, json: async () => body });
    await expect(new GoogleVisionOcr('k', resp(429)).recognize([img])).rejects.toBeInstanceOf(TransientError);
    await expect(new GoogleVisionOcr('k', resp(503)).recognize([img])).rejects.toBeInstanceOf(TransientError);
    await expect(new GoogleVisionOcr('k', resp(400)).recognize([img])).rejects.toBeInstanceOf(PermanentError);
    await expect(new GoogleVisionOcr('k', resp(403)).recognize([img])).rejects.toBeInstanceOf(TransientError);
    await expect(new GoogleVisionOcr('k', async () => { throw new Error('ECONNRESET'); }).recognize([img])).rejects.toBeInstanceOf(TransientError);
    const ok = await new GoogleVisionOcr('k', resp(200, gcvBody)).recognize([img]);
    expect(ok[0]!.text).toContain('MILO');
    expect(() => new GoogleVisionOcr('')).toThrow(/GOOGLE_VISION_API_KEY/);
  });
  it('Claude menerima TEKS OCR (tanpa gambar) + petunjuk OCR; rawText = teks OCR; biaya OCR ditambahkan', async () => {
    const claude = new FakeClaude(fakeMessage({ json: llmStrukAeon() }));
    const ocr = { name: 'gcv', costPerImageUsd: 0.0015, recognize: async () => [{ position: 1, text: 'AEON BSD\nTOTAL 114.700', lines: [{ text: 'AEON BSD', box: { x: 0.1, y: 0.05, w: 0.3, h: 0.02 } }] }] };
    const images = [{ position: 1, storagePath: 'x', sha256: '', data: fixtureImages('struk-aeon')[0]! }];
    const prepared = await prepareImages(images);
    const x = await new OcrThenParseExtractor(ocr, claude, { model: 'claude-opus-5-5', effortReceipt: 'low', effortObservation: 'low' }).extract({
      kind: 'receipt',
      images: [{ ...images[0]!, prepared: prepared[0] }],
      ctx: { captureId: 'c', householdId: 'h', attempt: 1, uploadedAt: new Date('2026-10-16T00:00:00Z'), capturedAt: null },
    });
    const params = claude.calls[0]!.params;
    const content = params.messages[0]!.content as { type: string; text?: string }[];
    expect(content.some((b) => b.type === 'image')).toBe(false);
    expect(content[1]!.text).toContain('[0.100,0.050,0.300,0.020] AEON BSD');
    expect((params.system as { text: string }[])[0]!.text.endsWith(OCR_HINT)).toBe(true);
    expect(params.output_config?.effort).toBe('low');
    expect(x.rawText).toBe('AEON BSD\nTOTAL 114.700');
    expect(x.output.kind).toBe('receipt');
    const meta = (x.rawOutput as { meta: { cost_usd: number; ocr_engine: string } }).meta;
    expect(meta.ocr_engine).toBe('gcv');
    expect(x.usage?.costUsd).toBeCloseTo(meta.cost_usd + 0.0015, 6);
  });
});

// ------------------------------------------------------------------ alur penuh sintetis

describe('alur harness sintetis: init → run (batch + realtime, klien palsu) → score → report', () => {
  const out: string[] = [];
  const log = (s: string) => out.push(s);

  it('init --synthetic dari fixture: manifest + ground truth tervalidasi, split tercatat', async () => {
    expect(await cli(['init', '--synthetic', '--from-fixtures', '--dir', DATA], log)).toBe(0);
    const m = readManifest(paths);
    expect(m.entries.map((e) => e.id).sort()).toEqual(['label-kamera', 'label-milo', 'shopee-milo', 'shopee-milo-ragu', 'struk-aeon', 'struk-alfamart-timeout', 'struk-buram', 'struk-tanpa-toko']);
    expect(new Set(m.entries.map((e) => e.split))).toEqual(new Set(['dev', 'test']));
    expect(readTruth(paths, 'struk-buram')!.expected).toBeNull();
    expect(readTruth(paths, 'struk-aeon')!.annotations.lines['2']).toEqual({ member_discount: true });
  });

  it('batch: satu batch, custom_id unik, TANPA betas/fallbacks (F-116), hasil dipetakan walau urutan acak', async () => {
    const before = new Set(existsSync(paths.runs) ? readdirSync(paths.runs) : []);
    expect(await cli(['run', '--set', 'all', '--arms', 'vision-opus-low,vision-haiku', '--repeat', '2', '--client', 'fake', '--dir', DATA], log)).toBe(0);
    const dir = readdirSync(paths.runs).find((d) => !before.has(d))!;
    expect(dir).toMatch(/-batch-fake$/);
    const state = JSON.parse(readFileSync(join(paths.runs, dir, 'batch.json'), 'utf8')) as { requests: Record<string, unknown> };
    expect(Object.keys(state.requests)).toHaveLength(2 * 8 * 2);
    expect(Object.keys(state.requests)).toContain('vision-haiku:struk-aeon:2');
    const recs = readdirSync(join(paths.runs, dir, 'vision-opus-low'));
    expect(recs).toContain('struk-aeon-r2.json');
    const r = JSON.parse(readFileSync(join(paths.runs, dir, 'vision-opus-low', 'struk-aeon-r1.json'), 'utf8')) as RunRecord;
    expect(r).toMatchObject({ ok: true, mode: 'batch', prompt_version: 'v1' });
    expect(r.cost_usd).toBeGreaterThan(0);
    const blurry = JSON.parse(readFileSync(join(paths.runs, dir, 'vision-opus-low', 'struk-buram-r1.json'), 'utf8')) as RunRecord;
    expect(blurry).toMatchObject({ ok: false, error: { code: 'blurry' } });
    // Buku biaya klien palsu terpisah dari buku biaya sungguhan.
    expect(existsSync(paths.ledger)).toBe(false);
    expect(existsSync(paths.ledger.replace('.json', '.fake.json'))).toBe(true);
  });

  it('batch params: fallbacks dibuang; realtime: fallbacks seperti produksi (kecuali Haiku)', async () => {
    const t = readTruth(paths, 'label-milo')!;
    const client = new FakeEvalClient(new Map([[t.id, t]]), new Map());
    const { runBatch, runRealtime, Budget: B } = await import('../eval/run.ts');
    const hashes = new Map<string, string>();
    const { sha } = await import('../eval/fake.ts');
    const prepared = await prepareImages([{ position: 1, storagePath: 'x', sha256: '', data: readFileSync(join(paths.images, 'label-milo-1.jpg')) }]);
    hashes.set(sha(prepared[0]!.data.toString('base64')), 'label-milo');
    const c2 = new FakeEvalClient(new Map([[t.id, t]]), hashes);
    const entry = readManifest(paths).entries.find((e) => e.id === 'label-milo')!;
    const plan = { arms: resolveArms('vision-opus-low,vision-haiku'), entries: [entry], repeat: 1, client: c2, budget: new B(join(DATA, 'spend-b.json'), 5), label: 'x-batch', pollMs: 1 };
    await runBatch(paths, { ...plan, mode: 'batch' });
    const sent = [...c2.batchStore.values()][0]!;
    expect(sent).toHaveLength(2);
    for (const r of sent) {
      expect(r.params).not.toHaveProperty('betas');
      expect(r.params).not.toHaveProperty('fallbacks');
      expect(r.params.output_config?.format).toBeTruthy();
    }
    const spy: unknown[] = [];
    const orig = c2.beta.messages.create;
    c2.beta.messages.create = async (p) => (spy.push(p), orig(p));
    await runRealtime(paths, { ...plan, label: 'x-rt', mode: 'realtime' });
    expect(spy[0]).toMatchObject({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
    expect(spy[1]).not.toHaveProperty('fallbacks');
    expect(client.calls).toHaveLength(0);
    rmSync(join(paths.runs, 'x-batch'), { recursive: true });
    rmSync(join(paths.runs, 'x-rt'), { recursive: true });
  });

  it('latency: realtime pada subset test, latensi tercatat', async () => {
    expect(await cli(['run', '--arms', 'vision-opus-low', '--mode', 'latency', '--client', 'fake', '--dir', DATA], log)).toBe(0);
    const r = buildReport(paths, { client: ['fake'] });
    expect(r.arms.find((a) => a.arm === 'vision-opus-low')!.realtime!.latency_ms.n).toBeGreaterThan(0);
  });

  it('batas biaya: --budget kecil menolak batch sebelum dikirim', async () => {
    await expect(cli(['run', '--set', 'all', '--arms', 'vision-opus-medium', '--client', 'fake', '--budget', '0.001', '--dir', DATA], log)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('score + report: agregat tanpa teks struk; arm murah berderau terlihat; label sintetis ditandai', async () => {
    expect(await cli(['score', '--dir', DATA], log)).toBe(0);
    expect(await cli(['report', '--dir', DATA], log)).toBe(0);
    const files = readdirSync(paths.reports);
    const agg = files.find((f) => f.endsWith('.agg.json'))!;
    const text = readFileSync(join(paths.reports, agg), 'utf8');
    for (const secret of ['MILO', 'AEON', 'INDOMIE', 'Alfamart', 'struk-aeon', '081298765432', '4321', 'Nestle']) expect(text).not.toContain(secret);
    const r = JSON.parse(text) as ReturnType<typeof buildReport>;
    expect(r.synthetic).toBe(true);
    const low = r.arms.find((a) => a.arm === 'vision-opus-low')!;
    const haiku = r.arms.find((a) => a.arm === 'vision-haiku')!;
    expect(low.test.receipt!.rates['lines.amount']!.rate).toBe(1);
    expect(haiku.test.receipt!.rates['lines.amount']!.rate).toBeLessThan(1);
    expect(low.criteria.receipt_pass).toBe(true);
    expect(haiku.criteria.receipt_pass).toBe(false);
    expect(r.decision.receipt.chosen).toBe('vision-opus-low');
    expect(readFileSync(join(paths.reports, agg.replace('.agg.json', '.md')), 'utf8')).toContain('Data sintetis');
  });
});

// ------------------------------------------------------------------ alat anotasi

describe('alat anotasi lokal (§4.2 langkah 3)', () => {
  it('daftar, item dengan pra-isi dari run arm, simpan → verified + jumlah field diubah; origin asing ditolak', async () => {
    // Hapus ground truth label-milo supaya pra-isi dipakai.
    rmSync(join(paths.truth, 'label-milo.json'));
    const server = createAnnotateServer(paths, { prefillArm: 'vision-opus-low', noPrefillFirst: 5 });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const list = (await (await fetch(`${base}/api/list`)).json()) as { id: string; status: string }[];
      expect(list.find((i) => i.id === 'label-milo')!.status).toBe('none');
      const item = (await (await fetch(`${base}/api/item/label-milo`)).json()) as { prefill: { items: { normal_price: number }[] }; prefill_arm: string };
      expect(item.prefill_arm).toBe('vision-opus-low');
      expect(item.prefill.items).toHaveLength(2);
      // Struk dalam 5 pertama: tanpa pra-isi (ukuran bias pra-isi).
      expect(((await (await fetch(`${base}/api/item/struk-aeon`)).json()) as { prefill: unknown }).prefill).toBeNull();
      expect((await fetch(`${base}/images/label-milo-1.jpg`)).headers.get('content-type')).toBe('image/jpeg');
      expect((await fetch(`${base}/images/..%2Fmanifest.json`)).status).toBe(400);

      const expected = structuredClone(item.prefill) as { items: { normal_price: number }[] };
      expected.items[0]!.normal_price = 19000;
      const put = (body: unknown, origin?: string) =>
        fetch(`${base}/api/item/label-milo`, { method: 'PUT', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
      expect((await put({ truth: { store_category: 'hypermarket', expected: { kind: 'receipt' } }, unchecked: 0, prefill_arm: null })).status).toBe(422);
      expect((await put({ truth: { store_category: 'hypermarket', expected }, unchecked: 0, prefill_arm: 'vision-opus-low' }, 'https://evil.example')).status).toBe(403);
      const ok = await put({ truth: { store_category: 'hypermarket', conditions: [], expected }, unchecked: 3, prefill_arm: 'vision-opus-low' });
      expect(ok.status).toBe(200);
      const saved = readTruth(paths, 'label-milo')!;
      expect(saved.verified).toMatchObject({ by: 'owner', prefill: 'vision-opus-low', prefill_changed_fields: 1, unchecked_fields: 3 });
    } finally {
      server.close();
    }
  });
  it('kebalikan konverter (klien palsu) menghasilkan skema LLM yang valid', async () => {
    const { LlmReceiptSchema, LlmObservationSchema } = await import('../src/extractors/llm-schema.ts');
    expect(LlmReceiptSchema.safeParse(llmFromTruth(receiptTruth(), 'claude-opus-5-5', 'low')).success).toBe(true);
    expect(LlmReceiptSchema.safeParse(llmFromTruth({ ...receiptTruth(), expected: null }, 'claude-opus-5-5', 'low')).success).toBe(true);
    expect(LlmObservationSchema.safeParse(llmFromTruth(readTruth(paths, 'shopee-milo')!, 'claude-haiku-5-5', 'medium')).success).toBe(true);
  });
});
