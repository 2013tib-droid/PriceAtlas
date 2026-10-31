// L2 (docs/08 §5.1, 6b M2): pemilihan extractor + matcher tier 4 dari env (select.ts) tanpa jaringan.
// Klien Claude/OCR lewat factory palsu; database tidak disentuh (matcher hanya dibuat).
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { ClaudeAiMatcher } from '../src/extractors/ai-matcher.ts';
import { OcrThenParseExtractor, type OcrEngine } from '../src/extractors/ocr-parse.ts';
import { selectAi, verifyClaude, type AiEnv, type AiFactories } from '../src/extractors/select.ts';
import { StubAiMatcher, StubExtractor } from '../src/extractors/stub.ts';
import { NoAiMatcher, OffExtractor } from '../src/extractors/text.ts';
import { VisionExtractor } from '../src/extractors/vision.ts';
import { FakeClaude, apiError } from './claude-fake.ts';
import { fixtures, logs } from './helpers.ts';

const db = {} as Db;
const KEY = 'sk-ant-worker-palsu';

function factories(over: Partial<AiFactories> = {}) {
  const made = { claude: [] as string[], ocr: [] as string[], stub: 0 };
  const fake = new FakeClaude();
  const f: AiFactories = {
    claude: (k) => {
      made.claude.push(k);
      return fake;
    },
    ocr: (engine) => {
      made.ocr.push(engine);
      return { name: 'gcv', recognize: async () => ({ pages: [], costUsd: 0 }) } satisfies OcrEngine;
    },
    stub: () => {
      made.stub++;
      return { fixtures, fallback: null };
    },
    ...over,
  };
  return { f, made, fake };
}

const pick = (env: AiEnv, over?: Partial<AiFactories>) => {
  const x = factories(over);
  return { ...x, sel: selectAi(env, db, x.f) };
};

describe('default (CI/e2e)', () => {
  it('tanpa env → stub + stub, tanpa klien Claude dan tanpa kunci', async () => {
    const { sel, made } = pick({});
    expect(sel.extractor).toBeInstanceOf(StubExtractor);
    expect(sel.ai).toBeInstanceOf(StubAiMatcher);
    expect(made).toEqual({ claude: [], ocr: [], stub: 1 });
    expect(sel.info).toEqual({ extractor: 'stub', engine: 'stub', model: null, effort_receipt: null, effort_observation: null, matcher: 'stub' });
    await expect(sel.verify()).resolves.toBeUndefined();
  });

  it('nilai tidak dikenal → gagal start', () => {
    expect(() => pick({ EXTRACTOR: 'tesseract' })).toThrow(/EXTRACTOR tidak dikenal: tesseract/);
    expect(() => pick({ AI_MATCHER: 'gpt' })).toThrow(/AI_MATCHER tidak dikenal/);
    expect(() => pick({ EXTRACTOR: 'vision', WORKER_ANTHROPIC_API_KEY: KEY, EXTRACT_EFFORT_RECEIPT: 'max' })).toThrow(/EXTRACT_EFFORT_RECEIPT/);
  });
});

describe('mode pribadi tanpa anggaran (D-100)', () => {
  it('EXTRACTOR=off + AI_MATCHER=off → tanpa Claude, tanpa fixture, hanya mengklaim teks', async () => {
    const { sel, made } = pick({ EXTRACTOR: 'off', AI_MATCHER: 'off' });
    expect(sel.extractor).toBeInstanceOf(OffExtractor);
    expect(sel.ai).toBeInstanceOf(NoAiMatcher);
    expect(sel.sources).toEqual(['text']);
    expect(made).toEqual({ claude: [], ocr: [], stub: 0 });
    expect(sel.info).toMatchObject({ extractor: 'off', engine: 'off', model: null, matcher: 'off' });
    await expect(sel.verify()).resolves.toBeUndefined();
    await expect(sel.ai.match([{ key: 1, raw_text: 'MILO' }], { householdId: 'h', storeId: null, kind: 'receipt', imageSha256s: [] })).resolves.toEqual([]);
  });

  it('extractor lain tetap mengklaim semua sumber (teks selalu lewat TextExtractor)', () => {
    expect(pick({}).sel.sources).toBeNull();
    expect(pick({ EXTRACTOR: 'vision', WORKER_ANTHROPIC_API_KEY: KEY }).sel.sources).toBeNull();
  });
});

describe('kunci worker (F-167)', () => {
  it('vision tanpa WORKER_ANTHROPIC_API_KEY → gagal start; ANTHROPIC_API_KEY (kunci web) tidak dipakai', () => {
    expect(() => pick({ EXTRACTOR: 'vision' })).toThrow(/WORKER_ANTHROPIC_API_KEY wajib/);
    expect(() => pick({ EXTRACTOR: 'vision', ANTHROPIC_API_KEY: 'sk-ant-web' })).toThrow(/kunci web \(Tanya\) dan tidak dipakai worker/);
    expect(() => pick({ AI_MATCHER: 'claude' })).toThrow(/AI_MATCHER=claude/);
  });

  it('kunci worker diteruskan ke klien; tidak pernah ada di info log', () => {
    const { sel, made } = pick({ EXTRACTOR: 'vision', AI_MATCHER: 'claude', WORKER_ANTHROPIC_API_KEY: KEY, ANTHROPIC_API_KEY: 'sk-ant-web' });
    expect(made.claude).toEqual([KEY]);
    expect(JSON.stringify(sel.info)).not.toMatch(/sk-ant/);
  });

  it('model di luar tabel harga → gagal start (biaya tidak terhitung, F-169)', () => {
    expect(() => pick({ EXTRACTOR: 'vision', WORKER_ANTHROPIC_API_KEY: KEY, EXTRACT_MODEL: 'claude-opus-9' })).toThrow(/tidak ada di tabel harga/);
  });
});

describe('extractor sungguhan + matcher claude', () => {
  it('vision: model/effort dari env; matcher memakai klien dan model yang sama', () => {
    const { sel, made, fake } = pick({
      EXTRACTOR: 'vision',
      AI_MATCHER: 'claude',
      WORKER_ANTHROPIC_API_KEY: KEY,
      EXTRACT_MODEL: 'claude-sonnet-5-5',
      EXTRACT_EFFORT_RECEIPT: 'high',
    });
    expect(sel.extractor).toBeInstanceOf(VisionExtractor);
    expect(sel.extractor).toMatchObject({ engine: 'claude-vision', model: 'claude-sonnet-5-5', promptVersion: 'v1' });
    expect(sel.ai).toBeInstanceOf(ClaudeAiMatcher);
    expect(made).toEqual({ claude: [KEY], ocr: [], stub: 0 });
    expect(sel.info).toEqual({
      extractor: 'vision',
      engine: 'claude-vision',
      model: 'claude-sonnet-5-5',
      effort_receipt: 'high',
      effort_observation: 'low',
      matcher: 'claude',
    });
    // Satu klien untuk extractor dan matcher.
    expect((sel.extractor as unknown as { client: unknown }).client).toBe(fake);
    expect((sel.ai as unknown as { client: unknown; cfg: { model: string } }).client).toBe(fake);
    expect((sel.ai as unknown as { cfg: { model: string } }).cfg.model).toBe('claude-sonnet-5-5');
  });

  it('ocr+parse: OCR_ENGINE default google-vision, engine gcv+claude', () => {
    const { sel, made } = pick({ EXTRACTOR: 'ocr+parse', WORKER_ANTHROPIC_API_KEY: KEY });
    expect(sel.extractor).toBeInstanceOf(OcrThenParseExtractor);
    expect(sel.extractor.engine).toBe('gcv+claude');
    expect(made.ocr).toEqual(['google-vision']);
    // AI_MATCHER default tetap stub (fixture), terpisah dari extractor.
    expect(sel.ai).toBeInstanceOf(StubAiMatcher);
  });

  it('ocr+parse dengan factory asli: tanpa GOOGLE_VISION_API_KEY atau engine lain → gagal start', async () => {
    const { defaultFactories } = await import('../src/extractors/select.ts');
    const real = defaultFactories('/tidak-ada', undefined);
    const f = { ...real, claude: () => new FakeClaude() };
    expect(() => selectAi({ EXTRACTOR: 'ocr+parse', AI_MATCHER: 'claude', WORKER_ANTHROPIC_API_KEY: KEY }, db, f)).toThrow(/GOOGLE_VISION_API_KEY wajib/);
    expect(() => selectAi({ EXTRACTOR: 'ocr+parse', AI_MATCHER: 'claude', WORKER_ANTHROPIC_API_KEY: KEY, OCR_ENGINE: 'textract', GOOGLE_VISION_API_KEY: 'g' }, db, f)).toThrow(
      /OCR_ENGINE tidak dikenal/,
    );
  });

  it('matcher claude dengan extractor stub (uji tier 4 di dev) → klien dibuat, extractor tetap fixture', () => {
    const { sel, made } = pick({ AI_MATCHER: 'claude', WORKER_ANTHROPIC_API_KEY: KEY });
    expect(sel.extractor).toBeInstanceOf(StubExtractor);
    expect(sel.ai).toBeInstanceOf(ClaudeAiMatcher);
    expect(made.claude).toHaveLength(1);
    expect(sel.info).toMatchObject({ model: 'claude-opus-5-5', effort_receipt: null, matcher: 'claude' });
  });
});

describe('cek kunci/model saat start (F-170)', () => {
  it('sukses → models.retrieve(EXTRACT_MODEL)', async () => {
    const { sel, fake } = pick({ EXTRACTOR: 'vision', WORKER_ANTHROPIC_API_KEY: KEY, EXTRACT_MODEL: 'claude-haiku-5-5' });
    await sel.verify();
    expect(fake.retrieved).toEqual(['claude-haiku-5-5']);
  });

  it('401/403 → kunci ditolak; 404 → model tidak tersedia', async () => {
    const fake = new FakeClaude();
    for (const [err, msg] of [
      [apiError.auth(), /WORKER_ANTHROPIC_API_KEY ditolak Anthropic \(401\)/],
      [apiError.permission(), /ditolak Anthropic \(403\)/],
      [apiError.notFound(), /EXTRACT_MODEL=claude-opus-5-5 tidak tersedia/],
    ] as const) {
      fake.modelsError = err;
      await expect(verifyClaude(fake, 'claude-opus-5-5')).rejects.toThrow(msg);
    }
  });

  it('jaringan/5xx saat start → worker tetap jalan, log ai.verify_skipped', async () => {
    const fake = new FakeClaude();
    const before = logs.filter((l) => l.includes('"ai.verify_skipped"')).length;
    fake.modelsError = apiError.connection();
    await expect(verifyClaude(fake, 'claude-opus-5-5')).resolves.toBeUndefined();
    fake.modelsError = new Anthropic.InternalServerError(503, undefined, 'x', new Headers());
    await expect(verifyClaude(fake, 'claude-opus-5-5')).resolves.toBeUndefined();
    expect(logs.filter((l) => l.includes('"ai.verify_skipped"')).length - before).toBe(2);
  });
});
