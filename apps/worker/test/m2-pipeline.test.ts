// L3 (docs/08 §5.4, §13.2; 6b M2): extractor yang dipilih env (select.ts) — vision dan ocr+parse — plus
// ClaudeAiMatcher melewati pipeline penuh dengan klien palsu (tanpa jaringan, tanpa kunci): error per
// baris tabel §5.4, tenggat lease untuk OCR + ekstraksi + tier 4, dan biaya gabungan per run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from '@priceatlas/testkit';
import type { OcrEngine, OcrResult } from '../src/extractors/ocr-parse.ts';
import { selectAi } from '../src/extractors/select.ts';
import { processNextCapture, type PipelineDeps } from '../src/pipeline/process-capture.ts';
import { PermanentError, TransientError, type PreparedImage } from '../src/pipeline/types.ts';
import { FakeClaude, apiError, fakeMessage, llmStrukAeon } from './claude-fake.ts';
import { captureRow, logs, setupEnv, skipBackoff, submitFixture, type Env } from './helpers.ts';

let env: Env;
const KERIPIK = '7a000000-0000-0000-0000-00000000c002';
const MODEL = 'claude-sonnet-5-5';

beforeAll(async () => {
  env = setupEnv('priceatlas_l3_m2', 'w-m2');
  // Produk privat Ani untuk daftar pendek tier 4 baris "SNACK XYZ" (lihat ai-matcher.test.ts).
  const hh = await env.admin.query<{ id: string }>('select household_id as id from public.household_member where user_id = $1', [USERS.a]);
  await env.admin.query(
    `insert into public.product (id, household_id, name, variant, content_size, content_unit) values ($1, $2, 'Keripik XYZ', 'Pedas', 70, 'g')`,
    [KERIPIK, hh.rows[0]!.id],
  );
});
afterAll(async () => {
  await env.close();
});

/** OCR palsu: teks struk-aeon per bagian; langkah berikutnya bisa berupa error. */
class FakeOcr implements OcrEngine {
  readonly name = 'gcv';
  readonly calls: { images: PreparedImage[]; signal?: AbortSignal }[] = [];
  constructor(private readonly steps: (Error | null)[] = []) {}
  async recognize(images: PreparedImage[], signal?: AbortSignal): Promise<OcrResult> {
    this.calls.push({ images, signal });
    if (signal?.aborted) throw new TransientError('ocr: tenggat lease habis');
    const step = this.steps.shift();
    if (step) throw step;
    return {
      pages: images.map((img) => ({
        position: img.position,
        text: 'AEON BSD\nMILO ORI 500G 2 x 45.000 90.000\nSNACK XYZ 12.000\nTOTAL 114.700',
        lines: [{ text: 'MILO ORI 500G 2 x 45.000 90.000', box: { x: 0.1, y: 0.2, w: 0.8, h: 0.03 } }],
      })),
      costUsd: 0.0015,
    };
  }
}

type Kind = 'vision' | 'ocr+parse';

function deps(kind: Kind, fake: FakeClaude, ocr = new FakeOcr(), over: Partial<PipelineDeps> = {}): PipelineDeps {
  const sel = selectAi(
    { EXTRACTOR: kind, AI_MATCHER: 'claude', WORKER_ANTHROPIC_API_KEY: 'sk-ant-worker-palsu', EXTRACT_MODEL: MODEL, EXTRACT_EFFORT_RECEIPT: 'high' },
    env.workerDb,
    { claude: () => fake, ocr: () => ocr, stub: () => { throw new Error('stub tidak dipakai'); } },
  );
  return { ...env.deps, extractor: sel.extractor, ai: sel.ai, ...over };
}

const extraction = () => fakeMessage({ json: llmStrukAeon(), model: MODEL, usage: { input_tokens: 6000, output_tokens: 3000 } });
const tier4 = (usage = { input_tokens: 1000, output_tokens: 200 }) =>
  fakeMessage({ json: { matches: [{ item: 1, choice: 1, confidence: 0.95, reason: 'sama' }] }, model: MODEL, usage });

async function runs(captureId: string) {
  const r = await env.admin.query(
    'select status, ocr_engine, ai_model, prompt_version, raw_ocr_text, raw_ai_output, input_tokens, output_tokens, cost_usd from public.processing_run where capture_id = $1 order by started_at',
    [captureId],
  );
  return r.rows;
}

/** Capture yang sengaja ditinggal `uploaded` (backoff) dibuang supaya tidak di-claim test berikutnya. */
async function discard(captureId: string) {
  await env.admin.query('delete from public.capture where id = $1', [captureId]);
}

const countLog = (event: string) => logs.filter((l) => l.includes(`"${event}"`)).length;

describe.each<Kind>(['vision', 'ocr+parse'])('EXTRACTOR=%s', (kind) => {
  const engine = kind === 'vision' ? 'claude-vision' : 'gcv+claude';

  it('berhasil: model/effort dari env, tier 4 memakai klien + model + tenggat yang sama, biaya digabung', async () => {
    const fake = new FakeClaude(extraction(), tier4());
    const ocr = new FakeOcr();
    const { captureId } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(deps(kind, fake, ocr))).toMatchObject({ captureId, status: 'needs_confirmation' });

    const [ext, match] = fake.calls;
    expect(ext!.params).toMatchObject({ model: MODEL, output_config: { effort: 'high' } });
    expect(match!.params).toMatchObject({ model: MODEL, output_config: { effort: 'low' }, max_tokens: 2000 });
    expect(match!.signal).toBe(ext!.signal);
    expect(ext!.signal!.aborted).toBe(false);
    const blocks = (ext!.params.messages[0]!.content as { type: string; text?: string }[]).map((b) => b.type);
    if (kind === 'vision') {
      expect(blocks).toContain('image');
      expect(ocr.calls).toHaveLength(0);
    } else {
      // ocr+parse: gambar hanya ke OCR (tenggat sama), Claude menerima teks.
      expect(blocks).not.toContain('image');
      expect(ocr.calls).toHaveLength(1);
      expect(ocr.calls[0]!.signal).toBe(ext!.signal);
      expect(ocr.calls[0]!.images[0]!.mediaType).toBe('image/jpeg');
    }

    const [run] = await runs(captureId);
    expect(run).toMatchObject({ status: 'succeeded', ocr_engine: engine, ai_model: MODEL, prompt_version: 'v1', input_tokens: 7000, output_tokens: 3200 });
    // Sonnet 5.5: (7000 × 2 + 3200 × 10) / 1e6 = 0,046; ocr+parse + US$0,0015 per gambar.
    expect(Number(run.cost_usd)).toBeCloseTo(kind === 'vision' ? 0.046 : 0.0475, 6);
    expect(run.raw_ocr_text).toContain(kind === 'vision' ? 'MILO ORI 500G' : 'SNACK XYZ 12.000');
    const line = await env.admin.query(
      `select l.suggested_product_id, l.match_tier, l.match_confidence from public.receipt_line l
         join public.receipt r on r.id = l.receipt_id where r.capture_id = $1 and l.line_no = 5`,
      [captureId],
    );
    expect(line.rows[0]).toMatchObject({ suggested_product_id: KERIPIK, match_tier: 'ai' });
    expect(Number(line.rows[0].match_confidence)).toBe(0.85);
  });

  it.each([
    ['429 rate limit', apiError.rateLimit],
    ['500', apiError.server],
    ['529 overloaded', apiError.overloaded],
    ['koneksi putus', apiError.connection],
    ['timeout SDK', apiError.timeout],
  ])('§5.4 sementara: %s → uploaded (diulang pipeline), tanpa output mentah', async (_n, err) => {
    const { captureId } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(deps(kind, new FakeClaude(err())))).toMatchObject({ captureId, status: 'uploaded', attempt: 1 });
    const [run] = await runs(captureId);
    expect(run).toMatchObject({ status: 'failed', raw_ai_output: null });
    await discard(captureId);
  });

  it('§5.4 konfigurasi (401/403/404/400 parameter): sementara + ai.config_error; setelah percobaan maks → failed `other` (F-170)', async () => {
    const before = countLog('ai.config_error');
    const { captureId } = await submitFixture(env, 'struk-aeon');
    const fake = new FakeClaude(apiError.auth(), apiError.permission(), apiError.badParam());
    expect(await processNextCapture(deps(kind, fake))).toMatchObject({ captureId, attempt: 1, status: 'uploaded' });
    await skipBackoff(env, captureId);
    expect(await processNextCapture(deps(kind, fake))).toMatchObject({ captureId, attempt: 2, status: 'uploaded' });
    await skipBackoff(env, captureId);
    expect(await processNextCapture(deps(kind, fake))).toMatchObject({ captureId, attempt: 3, status: 'failed' });
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'failed', error_code: 'other' });
    expect(countLog('ai.config_error') - before).toBe(3);

    const { captureId: c2 } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(deps(kind, new FakeClaude(apiError.notFound())))).toMatchObject({ captureId: c2, status: 'uploaded' });
    await discard(c2);
  });

  it('§5.4 refusal → failed `other`; max_tokens percobaan 1 → diulang dengan max_tokens × 2', async () => {
    const { captureId } = await submitFixture(env, 'struk-aeon');
    await processNextCapture(deps(kind, new FakeClaude(fakeMessage({ text: '', stop_reason: 'refusal' }))));
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'failed', error_code: 'other' });

    const fake = new FakeClaude(fakeMessage({ text: '{"document":', stop_reason: 'max_tokens' }), extraction(), tier4());
    const { captureId: c2 } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(deps(kind, fake))).toMatchObject({ captureId: c2, status: 'uploaded' });
    await skipBackoff(env, c2);
    expect(await processNextCapture(deps(kind, fake))).toMatchObject({ captureId: c2, attempt: 2, status: 'needs_confirmation' });
    expect(fake.calls.map((c) => c.params.max_tokens)).toEqual([16000, 32000, 2000]);
  });

  it('tenggat lease sudah lewat → sementara, tanpa memakai percobaan permanen', async () => {
    const fake = new FakeClaude(async (_p, signal) => {
      if (signal?.aborted) throw apiError.abort();
      return extraction();
    });
    const ocr = new FakeOcr();
    const { captureId } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(deps(kind, fake, ocr, { leaseSeconds: 30 }))).toMatchObject({ captureId, status: 'uploaded' });
    if (kind === 'vision') expect(fake.calls[0]!.signal!.aborted).toBe(true);
    else {
      expect(ocr.calls[0]!.signal!.aborted).toBe(true);
      expect(fake.calls).toHaveLength(0);
    }
    await discard(captureId);
  });

  it('tenggat habis saat panggilan berjalan → abort, sementara', async () => {
    const fake = new FakeClaude(
      (_p, signal) =>
        new Promise((_res, rej) => {
          signal?.addEventListener('abort', () => rej(apiError.abort()));
        }),
    );
    const { captureId } = await submitFixture(env, 'struk-aeon');
    const t0 = Date.now();
    // Lease 31 dtk − margin 30 dtk = tenggat 1 dtk setelah claim.
    expect(await processNextCapture(deps(kind, fake, new FakeOcr(), { leaseSeconds: 31 }))).toMatchObject({ captureId, status: 'uploaded' });
    expect(Date.now() - t0).toBeLessThan(10_000);
    await discard(captureId);
  });

  it('tenggat habis sebelum tier 4 → item tanpa saran AI, capture tetap diterapkan (ai.match_failed)', async () => {
    const before = countLog('ai.match_failed');
    const fake = new FakeClaude(
      async () => {
        await new Promise((r) => setTimeout(r, 1_200));
        return extraction();
      },
      async (_p, signal) => {
        if (signal?.aborted) throw apiError.abort();
        return tier4();
      },
    );
    const { captureId } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(deps(kind, fake, new FakeOcr(), { leaseSeconds: 31 }))).toMatchObject({ captureId, status: 'needs_confirmation' });
    expect(fake.calls[1]!.signal!.aborted).toBe(true);
    expect(countLog('ai.match_failed') - before).toBe(1);
    const line = await env.admin.query(
      `select l.suggested_product_id from public.receipt_line l join public.receipt r on r.id = l.receipt_id
        where r.capture_id = $1 and l.line_no = 5`,
      [captureId],
    );
    expect(line.rows[0].suggested_product_id).toBeNull();
  });
});

describe('EXTRACTOR=vision: gambar', () => {
  it('§5.4 400 karena gambar → failed `unsupported`', async () => {
    const { captureId } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(deps('vision', new FakeClaude(apiError.badImage())))).toMatchObject({ captureId, status: 'failed' });
    expect(await captureRow(env, captureId)).toMatchObject({ error_code: 'unsupported', error_message: 'Format gambar ini belum didukung.' });
  });

  it('§5.4 413 → failed `unsupported`', async () => {
    const { captureId } = await submitFixture(env, 'struk-aeon');
    await processNextCapture(deps('vision', new FakeClaude(apiError.tooLarge())));
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'failed', error_code: 'unsupported' });
  });
});

describe('EXTRACTOR=ocr+parse: vendor OCR', () => {
  it('OCR sementara (429/5xx) → uploaded, Claude tidak dipanggil', async () => {
    const fake = new FakeClaude();
    const { captureId } = await submitFixture(env, 'struk-aeon');
    expect(await processNextCapture(deps('ocr+parse', fake, new FakeOcr([new TransientError('ocr: rate limit')])))).toMatchObject({
      captureId,
      status: 'uploaded',
    });
    expect(fake.calls).toHaveLength(0);
    await discard(captureId);
  });

  it('OCR menolak gambar → failed `unsupported`, Claude tidak dipanggil', async () => {
    const fake = new FakeClaude();
    const { captureId } = await submitFixture(env, 'struk-aeon');
    await processNextCapture(deps('ocr+parse', fake, new FakeOcr([new PermanentError('unsupported', 'Format gambar ini belum didukung.')])));
    expect(await captureRow(env, captureId)).toMatchObject({ status: 'failed', error_code: 'unsupported' });
    expect(fake.calls).toHaveLength(0);
  });
});
