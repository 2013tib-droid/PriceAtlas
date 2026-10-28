// L2 harness uji OCR (docs/08 §4.2–§4.6, §5.6, §13.2): guard data (F-117), init + split, run batch /
// realtime dengan klien palsu, anggaran, OCR Google Vision (fetch palsu), alat anotasi, CLI end-to-end
// pada set sintetis. Tanpa jaringan, tanpa kunci, tanpa database.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Form from '../eval/annotate/form.js';
import { createAnnotateServer, listen } from '../eval/annotate/server.ts';
import { ARMS, armById, parseArms } from '../eval/arms.ts';
import { main } from '../eval/cli.ts';
import { GuardError, TruthSchema, assertIgnored, readAllTruths, readManifest, stripConfidence } from '../eval/data.ts';
import { FakeEvalClient, FakeOcr } from '../eval/fake-client.ts';
import { assignSplits, importSynthetic, initData } from '../eval/init.ts';
import { REPORT_SCHEMA } from '../eval/report.ts';
import { Budget, customId, estimateCostUsd, readRecords, runBatch, runRealtime, selectCaptures, type EvalClient } from '../eval/run.ts';
import { writeSyntheticSet } from '../eval/synthetic/set.ts';
import { GoogleVisionOcr, linesFromAnnotation, type FetchLike } from '../src/extractors/ocr/google-vision.ts';
import { OcrThenParseExtractor } from '../src/extractors/ocr-parse.ts';
import { prepareImages } from '../src/images/prepare.ts';
import { PermanentError, TransientError } from '../src/pipeline/types.ts';
import { FakeClaude, fakeMessage, llmStrukAeon } from './claude-fake.ts';
import { fixtureImages } from './helpers.ts';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `pa-eval-${p}-`));
const quiet = () => undefined;

let synthDir: string;
beforeAll(() => {
  synthDir = tmp('synth');
  writeSyntheticSet(synthDir);
});

describe('guard folder data (F-117)', () => {
  it('di luar repo git → boleh; di repo tanpa ignore → ditolak; di-ignore → boleh', () => {
    expect(() => assertIgnored(tmp('outside'))).not.toThrow();
    const repo = tmp('repo');
    execFileSync('git', ['init', '-q', repo]);
    expect(() => assertIgnored(join(repo, 'data'))).toThrow(GuardError);
    writeFileSync(join(repo, '.gitignore'), '.data/\n');
    expect(() => assertIgnored(join(repo, '.data', 'ocr-eval'))).not.toThrow();
  });
  it('folder default repo ini (.data/ocr-eval) di-ignore', () => {
    const d = join(import.meta.dirname, '../../../.data/ocr-eval-guard-test');
    expect(() => assertIgnored(d)).not.toThrow();
    rmSync(d, { recursive: true, force: true });
  });
});

describe('init (§4.2 langkah 2)', () => {
  it('inbox → id acak, gambar disalin, kategori dari folder, struk multi-bagian, file non-gambar dilewati', async () => {
    const dir = tmp('init');
    const jpg = (seed: number) => sharp({ create: { width: 300, height: 400, channels: 3, background: { r: seed, g: 100, b: 100 } } }).jpeg().toBuffer();
    const put = async (rel: string, seed: number) => {
      mkdirSync(join(dir, 'inbox', rel, '..'), { recursive: true });
      writeFileSync(join(dir, 'inbox', rel), await jpg(seed));
    };
    await put('struk/minimarket/IMG_1.jpg', 1);
    await put('struk/minimarket/panjang/IMG_3.jpg', 3);
    await put('struk/minimarket/panjang/IMG_2.jpg', 2);
    await put('struk/IMG_4.JPG', 4);
    await put('label/IMG_5.jpg', 5);
    await put('screenshot/IMG_6.jpg', 6);
    writeFileSync(join(dir, 'inbox', 'struk', 'catatan.txt'), 'bukan gambar');
    const r = initData(dir, { seed: 1 });
    expect(r).toMatchObject({ added: 5, skipped: 1, duplicates: 0, total: 5 });
    const m = readManifest(dir);
    const byKind = (k: string) => m.captures.filter((c) => c.kind === k);
    expect(byKind('receipt').map((c) => [c.store_category, c.images.length]).sort()).toEqual([['bebas', 1], ['minimarket', 1], ['minimarket', 2]]);
    const long = byKind('receipt').find((c) => c.images.length === 2)!;
    expect(long.conditions).toContain('long');
    // Bagian urut nama file (IMG_2 sebelum IMG_3), nama asli tidak disimpan.
    expect(readFileSync(join(dir, 'images', long.images[0]!))).toEqual(await jpg(2));
    expect(JSON.stringify(m)).not.toMatch(/IMG_|panjang|catatan/);
    expect(byKind('marketplace')[0]!.store_category).toBe('marketplace');
    for (const c of m.captures) expect(c.id).toMatch(/^[rls]-[0-9a-f]{4}$/);
    // Menjalankan ulang tidak mengimpor ulang.
    expect(initData(dir)).toMatchObject({ added: 0, duplicates: 5, total: 5 });
  });
  it('split berstrata 30 % dev; capture lama tidak dipindah', () => {
    const mk = (i: number, cat: 'minimarket' | 'supermarket') => ({
      id: `r-${String(i).padStart(4, '0')}`, kind: 'receipt' as const, store_category: cat, conditions: [], images: ['x.jpg'], uploaded_at: '', source_sha256: [String(i)],
    });
    const first = assignSplits([], [...Array(10)].map((_, i) => mk(i, 'minimarket')).concat([...Array(10)].map((_, i) => mk(10 + i, 'supermarket'))), 3);
    for (const cat of ['minimarket', 'supermarket']) expect(first.filter((e) => e.store_category === cat && e.split === 'dev')).toHaveLength(3);
    const more = assignSplits(first, [...Array(10)].map((_, i) => mk(20 + i, 'minimarket')), 3);
    expect([...first, ...more].filter((e) => e.store_category === 'minimarket' && e.split === 'dev')).toHaveLength(6);
  });
  it('set sintetis → truth terverifikasi berbentuk kontrak; struk-buram = tidak terbaca', () => {
    const dir = tmp('synthinit');
    const r = importSynthetic(dir, synthDir, { seed: 5 });
    expect(r.added).toBe(8);
    const truths = readAllTruths(dir);
    expect(truths).toHaveLength(8);
    for (const t of truths) {
      expect(TruthSchema.safeParse(t).success).toBe(true);
      expect(t.verified).toMatchObject({ by: 'synthetic', prefill: null });
    }
    expect(truths.filter((t) => t.expected === null)).toHaveLength(1);
    expect(truths.find((t) => t.annotations.transcript_pii.includes('081298765432'))?.annotations.lines['2']).toEqual({ member_discount: true });
  });
});

describe('arm (§4.5)', () => {
  it('lima arm, slug aman untuk custom_id, parse daftar', () => {
    expect(ARMS.map((a) => a.id)).toEqual(['vision-opus-low', 'vision-opus-medium', 'vision-sonnet', 'vision-haiku', 'ocr-gcv+opus-low']);
    for (const a of ARMS) expect(customId(a, 'r-ab12', 2)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(parseArms('vision-haiku,ocr-gcv+opus-low').map((a) => a.engine)).toEqual(['vision', 'ocr']);
    expect(() => armById('gpt')).toThrow(/arm tidak dikenal/);
  });
});

describe('run (§4.6)', () => {
  let dir: string;
  beforeAll(() => {
    dir = tmp('run');
    importSynthetic(dir, synthDir, { seed: 11 });
  });

  it('batch: tanpa fallbacks, custom_id per arm/id/ulangan, biaya × 0,5, OCR ditagih sendiri', async () => {
    const entries = selectCaptures(dir, 'all');
    const fake = await FakeEvalClient.create(dir, entries, readAllTruths(dir));
    const budget = new Budget(dir, 75);
    const r = await runBatch({ dir, arms: [armById('vision-opus-low'), armById('ocr-gcv+opus-low')], entries, repeat: 2, client: fake, ocr: new FakeOcr(fake), budget, pollSeconds: 0, log: quiet });
    expect(r.records).toBe(32); // 2 arm × 8 capture × 2 ulangan
    const recs = readRecords(dir, r.runDirs);
    expect(recs.every((x) => x.mode === 'batch' && x.purpose === 'accuracy')).toBe(true);
    const opus = recs.find((x) => x.arm === 'vision-opus-low' && x.ok && x.kind === 'receipt')!;
    // fakeMessage struk: 6.300 input + 3.000 output token Opus 5.5 = US$0,0852 → batch US$0,0426.
    expect(opus.cost_usd).toBeCloseTo(((2500 + 3800) * 4 + 3000 * 20) / 1e6 / 2, 6);
    const ocr = recs.find((x) => x.arm === 'ocr-gcv+opus-low' && x.ok && x.kind === 'receipt')!;
    expect(ocr.ocr_cost_usd).toBe(0.0015);
    expect(ocr.raw_text).toMatch(/^#r-/); // rawText = teks OCR vendor (§5.3)
    expect(fake.calls.every((p) => !('fallbacks' in p) && !('betas' in p))).toBe(true);
    expect(budget.spent).toBeCloseTo(recs.reduce((s, x) => s + (x.cost_usd ?? 0), 0), 6);
    expect(JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).total_usd).toBeCloseTo(budget.spent, 6);
    const batchFile = JSON.parse(readFileSync(join(r.runDirs[0]!, 'batch.json'), 'utf8'));
    expect(batchFile.custom_ids).toHaveLength(16);
  });

  it('anggaran: perkiraan melewati sisa → berhenti SEBELUM memanggil API', async () => {
    const entries = selectCaptures(dir, 'all');
    const fake = await FakeEvalClient.create(dir, entries, readAllTruths(dir));
    const before = fake.calls.length;
    const tiny = new Budget(dir, 0.01);
    const r = await runBatch({ dir, arms: [armById('vision-opus-medium')], entries, repeat: 1, client: fake, budget: tiny, pollSeconds: 0, log: quiet });
    expect(r.stoppedByBudget).toMatch(/Anggaran habis/);
    expect(fake.calls.length).toBe(before);
    const rt = await runRealtime({ dir, arms: [armById('vision-opus-medium')], entries, repeat: 1, client: fake, budget: tiny, log: quiet });
    expect(rt.stoppedByBudget).toMatch(/Anggaran habis/);
    expect(estimateCostUsd(armById('vision-opus-medium'), 'receipt', 2, 'realtime')).toBeCloseTo((2500 + 7600) * 4e-6 + 4600 * 20e-6, 6);
    expect(estimateCostUsd(armById('vision-opus-medium'), 'receipt', 2, 'batch')).toBeCloseTo(((2500 + 7600) * 4e-6 + 4600 * 20e-6) / 2, 6);
  });

  it('realtime: max_tokens di percobaan 1 → ulang dengan batas × 2 (F-128); latensi tercatat', async () => {
    const entries = selectCaptures(dir, 'all').filter((e) => e.kind === 'receipt' && readAllTruths(dir).find((t) => t.id === e.id)?.expected);
    const fake = new FakeClaude(fakeMessage({ text: '{', stop_reason: 'max_tokens' }), fakeMessage({ json: llmStrukAeon() }));
    const client = Object.assign(fake, { beta: { messages: { ...fake.beta.messages, batches: undefined as never } } }) as unknown as EvalClient;
    const r = await runRealtime({ dir, arms: [armById('vision-opus-medium')], entries: entries.slice(0, 1), repeat: 1, client, budget: new Budget(dir, 75), log: quiet, sleep: async () => undefined });
    const [rec] = readRecords(dir, r.runDirs);
    expect(rec).toMatchObject({ ok: true, attempts: 2, mode: 'realtime', purpose: 'both' });
    expect(rec!.latency_ms).toBeGreaterThanOrEqual(0);
    expect(fake.calls.map((c) => c.params.max_tokens)).toEqual([16000, 32000]);
    expect(fake.calls[0]!.params).toMatchObject({ fallbacks: 'default' }); // realtime = sama dengan produksi
  });
});

describe('OCR Google Cloud Vision (§5.6, Q-103)', () => {
  const word = (text: string, x: number, y: number, br?: string) => ({
    symbols: [...text].map((ch, i) => ({ text: ch, ...(i === text.length - 1 && br ? { property: { detectedBreak: { type: br } } } : {}) })),
    boundingBox: { vertices: [{ x, y }, { x: x + 50, y }, { x: x + 50, y: y + 10 }, { x, y: y + 10 }] },
  });
  const page = { width: 500, height: 1000, blocks: [{ paragraphs: [{ words: [word('MILO', 10, 100, 'SPACE'), word('500G', 70, 100, 'SPACE'), word('90.000', 400, 100, 'EOL_SURE_SPACE'), word('TOTAL', 10, 200, 'LINE_BREAK')] }] }] };

  it('kata → baris dengan kotak ternormalisasi', () => {
    const lines = linesFromAnnotation(page, { width: 500, height: 1000 });
    expect(lines.map((l) => l.text)).toEqual(['MILO 500G 90.000', 'TOTAL']);
    expect(lines[0]!.box).toEqual({ x: 0.02, y: 0.1, w: 0.88, h: 0.01 });
  });

  it('kunci di header (bukan URL), error dipetakan: 429/5xx sementara, 400 unsupported, 403 konfigurasi', async () => {
    const [img] = await prepareImages([{ position: 1, storagePath: 'x', sha256: 'x', data: fixtureImages('struk-aeon')[0]! }]);
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const respond = (status: number, json: unknown): FetchLike => async (url, init) => {
      seen.push({ url, headers: init.headers });
      return { ok: status === 200, status, json: async () => json };
    };
    const ok = await new GoogleVisionOcr('kunci-uji', respond(200, { responses: [{ fullTextAnnotation: { text: 'MILO 500G 90.000\nTOTAL', pages: [page] } }] })).recognize([img!]);
    expect(ok).toMatchObject({ costUsd: 0.0015, pages: [{ position: 1, text: 'MILO 500G 90.000\nTOTAL' }] });
    expect(seen[0]!.url).not.toMatch(/kunci-uji/);
    expect(seen[0]!.headers['x-goog-api-key']).toBe('kunci-uji');
    await expect(new GoogleVisionOcr('k', respond(429, {})).recognize([img!])).rejects.toBeInstanceOf(TransientError);
    await expect(new GoogleVisionOcr('k', respond(503, {})).recognize([img!])).rejects.toBeInstanceOf(TransientError);
    await expect(new GoogleVisionOcr('k', respond(400, {})).recognize([img!])).rejects.toMatchObject({ code: 'unsupported' });
    await expect(new GoogleVisionOcr('k', respond(403, {})).recognize([img!])).rejects.toBeInstanceOf(TransientError);
    await expect(new GoogleVisionOcr('k', respond(200, { responses: [{ error: { code: 3, message: 'bad image' } }] })).recognize([img!])).rejects.toBeInstanceOf(PermanentError);
    await expect(new GoogleVisionOcr('k', async () => { throw new Error('reset'); }).recognize([img!])).rejects.toBeInstanceOf(TransientError);
    expect(() => new GoogleVisionOcr('')).toThrow(/GOOGLE_VISION_API_KEY/);
  });

  it('OcrThenParseExtractor: teks OCR + kotak, gambar tidak dikirim, prompt OCR, biaya Claude + OCR', async () => {
    const data = fixtureImages('struk-aeon')[0]!;
    const [prepared] = await prepareImages([{ position: 1, storagePath: 'x', sha256: 'x', data }]);
    const fake = new FakeClaude(fakeMessage({ json: llmStrukAeon(), usage: { input_tokens: 4000, output_tokens: 3000 } }));
    const ocr = { name: 'gcv', recognize: async () => ({ costUsd: 0.0015, pages: [{ position: 1, text: 'AEON BSD\nMILO ORI 500G 90.000', lines: [{ text: 'MILO ORI 500G 90.000', box: { x: 0.1, y: 0.2, w: 0.8, h: 0.03 } }] }] }) };
    const ex = new OcrThenParseExtractor(fake, ocr, { model: 'claude-opus-5-5', effortReceipt: 'low', effortObservation: 'low' });
    expect(ex.engine).toBe('gcv+claude');
    const out = await ex.extract({ kind: 'receipt', images: [{ position: 1, storagePath: 'x', sha256: 'x', data, prepared }], ctx: { captureId: 'c', householdId: 'h', attempt: 1, uploadedAt: new Date('2026-10-16T03:00:00Z'), capturedAt: null } });
    const content = fake.calls[0]!.params.messages[0]!.content as { type: string; text?: string }[];
    expect(content.map((b) => b.type)).toEqual(['text', 'text']);
    expect(content[1]!.text).toBe('Bagian 1 dari 1 (teks OCR)\nMILO ORI 500G 90.000 [0.1,0.2,0.8,0.03]');
    expect((fake.calls[0]!.params.system as { text: string }[])[0]!.text).toMatch(/Input berupa teks OCR/);
    expect(out.rawText).toBe('AEON BSD\nMILO ORI 500G 90.000');
    expect(out.usage?.costUsd).toBeCloseTo((4000 * 4 + 3000 * 20) / 1e6 + 0.0015, 6);
    expect(out.output.kind).toBe('receipt');
  });
});

describe('alat anotasi (§4.2 langkah 3)', () => {
  let dir: string;
  let base: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    dir = tmp('annot');
    importSynthetic(dir, synthDir, { seed: 2 });
    // Hapus truth satu label supaya ada capture "baru" yang dipra-isi dari run palsu.
    const label = readManifest(dir).captures.find((c) => c.kind === 'price_label')!;
    rmSync(join(dir, 'truth', `${label.id}.json`));
    const server = createAnnotateServer({ dir, prefillArm: 'vision-opus-medium', now: () => new Date('2026-11-05T00:00:00Z') });
    const port = await listen(server, 0);
    base = `http://127.0.0.1:${port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });
  afterAll(async () => close());

  it('daftar capture, gambar JPEG bersih, Host selain localhost ditolak', async () => {
    const list = (await (await fetch(`${base}/api/captures`)).json()) as { captures: { id: string; status: string; blind: boolean }[] };
    expect(list.captures).toHaveLength(8);
    expect(list.captures.filter((c) => c.status === 'new')).toHaveLength(1);
    expect(list.captures.filter((c) => c.blind).length).toBeLessThanOrEqual(5);
    const m = readManifest(dir);
    const img = await fetch(`${base}/images/${m.captures[0]!.images[0]}`);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).exif).toBeUndefined();
    expect((await fetch(`${base}/images/..%2Fmanifest.json`)).status).toBe(404);
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('<title>Anotasi uji OCR</title>');
    // DNS rebinding: Host selain localhost ditolak (fetch tidak bisa menimpa Host, jadi lewat http).
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(base);
      request({ host: u.hostname, port: u.port, path: '/api/captures', headers: { host: 'evil.example' } }, (r) => resolve(r.statusCode ?? 0))
        .on('error', reject)
        .end();
    });
    expect(status).toBe(403);
  });

  it('PUT truth: tidak valid → 400 + path; lengkap → terverifikasi + kategori di manifest', async () => {
    const m = readManifest(dir);
    const id = m.captures.find((c) => c.kind === 'price_label')!.id;
    const bad = await fetch(`${base}/api/truth/${id}`, { method: 'PUT', body: JSON.stringify({ expected: { kind: 'price_label', items: [{ raw_text: 'X', normal_price: -1 }] }, annotations: {}, complete: true }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { issues: { path: string }[] }).issues[0]!.path).toMatch(/normal_price/);
    const state = { expected: Form.blankExpected('price_label'), checked: new Set<string>(), annotations: { lines: {}, transcript_pii: [] }, store_category: 'apotek', conditions: ['glare'] };
    (state.expected.items as Record<string, unknown>[]).push({ ...Form.blankItem(), raw_text: 'MILO', normal_price: 19500 });
    const draft = Form.truthPayload(state);
    expect(draft.complete).toBe(false);
    for (const p of Form.fieldPaths(state.expected)) state.checked.add(p);
    const payload = Form.truthPayload(state);
    expect(payload.complete).toBe(true);
    const ok = await fetch(`${base}/api/truth/${id}`, { method: 'PUT', body: JSON.stringify({ ...payload, prefill_arm: null }) });
    expect(await ok.json()).toEqual({ ok: true, verified: true });
    const saved = readAllTruths(dir).find((t) => t.id === id)!;
    expect(saved).toMatchObject({ store_category: 'apotek', conditions: ['glare'], verified: { by: 'owner', at: '2026-11-05', prefill: null } });
    expect(readManifest(dir).captures.find((c) => c.id === id)!.store_category).toBe('apotek');
  });
});

describe('form.js (logika alat anotasi)', () => {
  it('angka rupiah format Indonesia', () => {
    expect(Form.parseRupiah('Rp45.000')).toBe(45000);
    expect(Form.parseRupiah('-5.000')).toBe(-5000);
    expect(Form.parseRupiah('1.234,5')).toBe(1234.5);
    expect(Form.parseRupiah('')).toBeNull();
    expect(Form.parseRupiah('abc')).toBeNaN();
    expect(Form.parseValue('date', '15/10/2026')).toBeNaN();
    expect(Form.parseValue('time', '19:02')).toBe('19:02');
  });
  it('hapus baris: nomor ulang + applies_to bergeser; tanda diperiksa ikut bergeser', () => {
    const e = Form.blankExpected('receipt');
    for (let i = 0; i < 4; i++) Form.addLine(e);
    const lines = e.lines as { line_no: number; applies_to_line_no: number | null }[];
    lines[3]!.applies_to_line_no = 3;
    lines[2]!.applies_to_line_no = 2;
    Form.removeLine(e, 1);
    expect(lines.map((l) => [l.line_no, l.applies_to_line_no])).toEqual([[1, null], [2, null], [3, 2]]);
    expect([...Form.shiftChecked(['lines.0.raw_text', 'lines.1.raw_text', 'lines.2.raw_text', 'header.total_amount'], 'lines', 1)].sort())
      .toEqual(['header.total_amount', 'lines.0.raw_text', 'lines.1.raw_text']);
  });
  it('field yang wajib diperiksa; nilai tidak valid mencegah verifikasi; anotasi dibersihkan', () => {
    const e = Form.blankExpected('receipt');
    Form.addLine(e);
    expect(Form.fieldPaths(e)).toHaveLength(7 + 7);
    Form.setPath(e, 'header.total_amount', Number.NaN);
    const st = { expected: e, checked: new Set(Form.fieldPaths(e)), annotations: { lines: { '1': { weighed: true, member_discount: false } }, transcript_pii: [' 0812 ', ''] }, store_category: 'lokal', conditions: [] };
    expect(Form.invalidPaths(e)).toEqual(['header.total_amount']);
    expect(Form.truthPayload(st).complete).toBe(false);
    expect(Form.truthPayload(st).annotations).toEqual({ lines: { '1': { weighed: true } }, transcript_pii: ['0812'], notes: null });
    expect(Form.truthPayload({ ...st, unreadable: true })).toMatchObject({ expected: null, complete: true });
  });
  it('pra-isi = output model tanpa confidence', () => {
    const out = stripConfidence({ kind: 'receipt', header: { field_confidence: { date: 0.9 } }, pii: {}, adjustments: [], lines: [{ line_no: 1, line_type: 'product', raw_text: 'A', line_amount: 1, parse_confidence: 0.9 }] });
    expect(out).toEqual({ kind: 'receipt', header: { field_confidence: {} }, pii: {}, adjustments: [], lines: [{ line_no: 1, line_type: 'product', raw_text: 'A', line_amount: 1 }] });
  });
});

describe('CLI end-to-end pada set sintetis dengan klien palsu', () => {
  it('init → run (batch + subset latensi) → score → report; agregat tanpa teks/id', async () => {
    const dir = tmp('cli');
    const env = { OCR_EVAL_DIR: dir } as NodeJS.ProcessEnv;
    const out: string[] = [];
    const say = (s: string) => out.push(s);
    expect(await main(['init', '--synthetic', synthDir, '--seed', '9'], env, say)).toBe(0);
    expect(await main(['run', '--set', 'all', '--arms', 'all', '--repeat', '2', '--client', 'fake', '--poll', '0'], env, say)).toBe(0);
    expect(await main(['score', '--set', 'all'], env, say)).toBe(0);
    expect(await main(['report', '--set', 'all'], env, say)).toBe(0);
    const reports = readdirSync(join(dir, 'reports'));
    const agg = reports.find((f) => f.endsWith('.agg.json'))!;
    const json = readFileSync(join(dir, 'reports', agg), 'utf8');
    const report = JSON.parse(json);
    expect(report).toMatchObject({ schema: REPORT_SCHEMA, split: 'all', synthetic: true, prompt_version: 'v1' });
    expect(Object.keys(report.arms)).toEqual(ARMS.map((a) => a.id));
    expect(report.decision.receipt.chosen).toBeTruthy();
    expect(report.arms['vision-opus-low'].kinds.receipt.latency.n).toBeGreaterThan(0);
    // Agregat: tidak ada teks struk, nama toko, PII, id capture, atau path.
    for (const banned of ['MILO', 'INDOMIE', 'AEON', 'Shopee', 'Nestle', '081298765432', '4321', dir]) expect(json).not.toContain(banned);
    expect(json).not.toMatch(/\b[rls]-[0-9a-f]{4}\b/);
    // Klien palsu: biaya tiruan tidak masuk buku biaya uji sungguhan.
    expect(existsSync(join(dir, 'spend.json'))).toBe(false);
    expect(report.spend_total_usd).toBeNull();
    expect(out.join('\n')).toMatch(/agregat \(boleh dikirim\/di-commit\)/);
  });
  it('tanpa kunci API → pesan jelas; folder data di repo tanpa ignore → ditolak', async () => {
    const dir = tmp('cli2');
    const env = { OCR_EVAL_DIR: dir } as NodeJS.ProcessEnv;
    await main(['init', '--synthetic', synthDir], env, quiet);
    await expect(main(['run', '--set', 'all', '--arms', 'vision-haiku'], env, quiet)).rejects.toThrow(/ANTHROPIC_API_KEY/);
    const repo = tmp('cli-repo');
    execFileSync('git', ['init', '-q', repo]);
    await expect(main(['init'], { OCR_EVAL_DIR: join(repo, 'data') } as NodeJS.ProcessEnv, quiet)).rejects.toThrow(GuardError);
  });
});
