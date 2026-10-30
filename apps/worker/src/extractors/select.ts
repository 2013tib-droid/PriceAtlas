// Pemilihan extractor dan matcher tier 4 dari env (docs/08 §5.1, 6b M2). Dipisah dari main.ts supaya
// bisa diuji tanpa database/jaringan: klien Claude dan OCR dibuat lewat factory yang bisa diganti.
//   EXTRACTOR=stub | vision | ocr+parse        default stub (CI/e2e)
//   AI_MATCHER=stub | claude                   default stub (CI/e2e)
//   WORKER_ANTHROPIC_API_KEY                   kunci worker, wajib jika extractor ≠ stub atau matcher claude.
//                                              ANTHROPIC_API_KEY (kunci web) sengaja tidak dibaca (F-167).
//   EXTRACT_MODEL                              default claude-opus-5-5; harus ada di tabel harga (F-169)
//   EXTRACT_EFFORT_RECEIPT / _OBSERVATION      low | medium | high; default medium / low
//   OCR_ENGINE=google-vision + GOOGLE_VISION_API_KEY   hanya ocr+parse
// Kesalahan konfigurasi → worker gagal start dengan pesan jelas, bukan gagal per capture (§5.1).
// Kunci ditolak / model tidak tersedia dicek saat start lewat GET /v1/models/{model} (gratis, F-170):
// tanpa itu setiap capture memakai 3 percobaan lalu gagal `other` (fail_run, D-70).
import Anthropic from '@anthropic-ai/sdk';
import { log } from '../log.ts';
import { createClaudeClient, type ClaudeClient, type Effort } from '../ai/claude.ts';
import { priceOf } from '../ai/pricing.ts';
import type { Db } from '../db.ts';
import type { AiMatcher, CaptureExtractor } from '../pipeline/types.ts';
import { ClaudeAiMatcher } from './ai-matcher.ts';
import { GoogleVisionOcr } from './ocr/google-vision.ts';
import { OcrThenParseExtractor, type OcrEngine } from './ocr-parse.ts';
import { FixtureRegistry, StubAiMatcher, StubExtractor, fallbackFixture, type StubFixture } from './stub.ts';
import { VisionExtractor } from './vision.ts';

export const DEFAULT_EXTRACT_MODEL = 'claude-opus-5-5';
export const EXTRACTOR_KINDS = ['stub', 'vision', 'ocr+parse'] as const;
export const MATCHER_KINDS = ['stub', 'claude'] as const;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];

export type AiEnv = Record<string, string | undefined>;

/** Klien worker: Messages API + `models.retrieve` untuk cek kunci/model saat start. */
export type WorkerClaude = ClaudeClient & { models: { retrieve(model: string): PromiseLike<unknown> } };

export interface AiFactories {
  claude(apiKey: string): WorkerClaude;
  ocr(engine: string, env: AiEnv): OcrEngine;
  /** Fixture stub (registry + fallback e2e); hanya dipanggil jika extractor atau matcher = stub. */
  stub(): { fixtures: FixtureRegistry; fallback: StubFixture | null };
}

export interface AiSelection {
  extractor: CaptureExtractor;
  ai: AiMatcher;
  /** Cek kunci + model saat start (hanya jika Claude dipakai). Kunci/model salah → throw. */
  verify(): Promise<void>;
  /** Untuk log start (tanpa kunci). */
  info: { extractor: string; engine: string; model: string | null; effort_receipt: Effort | null; effort_observation: Effort | null; matcher: string };
}

export function defaultFactories(fixturesDir: string, fallbackName: string | undefined): AiFactories {
  return {
    claude: (apiKey) => createClaudeClient({ apiKey }),
    ocr: (engine, env) => {
      if (engine !== 'google-vision') throw new Error(`OCR_ENGINE tidak dikenal: ${engine} (pilihan: google-vision)`);
      const key = env.GOOGLE_VISION_API_KEY;
      if (!key) throw new Error('GOOGLE_VISION_API_KEY wajib diisi untuk EXTRACTOR=ocr+parse (docs/08 §5.1)');
      return new GoogleVisionOcr(key);
    },
    stub: () => {
      const fixtures = new FixtureRegistry(fixturesDir);
      return { fixtures, fallback: fallbackFixture(fixtures, fallbackName) };
    },
  };
}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[], dflt: T): T {
  const v = value?.trim() || dflt;
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`env ${name} tidak dikenal: ${v} (pilihan: ${allowed.join(' | ')})`);
  return v as T;
}

export function selectAi(env: AiEnv, db: Db, f: AiFactories): AiSelection {
  const kind = oneOf('EXTRACTOR', env.EXTRACTOR, EXTRACTOR_KINDS, 'stub');
  const matcherKind = oneOf('AI_MATCHER', env.AI_MATCHER, MATCHER_KINDS, 'stub');
  const needsClaude = kind !== 'stub' || matcherKind === 'claude';

  const model = env.EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL;
  const effortReceipt = oneOf('EXTRACT_EFFORT_RECEIPT', env.EXTRACT_EFFORT_RECEIPT, EFFORTS, 'medium');
  const effortObservation = oneOf('EXTRACT_EFFORT_OBSERVATION', env.EXTRACT_EFFORT_OBSERVATION, EFFORTS, 'low');

  let client: WorkerClaude | null = null;
  if (needsClaude) {
    const key = env.WORKER_ANTHROPIC_API_KEY?.trim();
    if (!key) {
      const hint = env.ANTHROPIC_API_KEY ? ' ANTHROPIC_API_KEY adalah kunci web (Tanya) dan tidak dipakai worker (F-167).' : '';
      throw new Error(`WORKER_ANTHROPIC_API_KEY wajib diisi untuk EXTRACTOR=${kind} / AI_MATCHER=${matcherKind} (docs/08 §5.1).${hint}`);
    }
    // Biaya model di luar tabel harga = null → anggaran harian (§12.3) tidak menghitungnya (F-169).
    if (!priceOf(model)) throw new Error(`EXTRACT_MODEL=${model} tidak ada di tabel harga (packages/ai-tools/src/pricing.ts); biaya tidak bisa dihitung`);
    client = f.claude(key);
  }

  const stub = kind === 'stub' || matcherKind === 'stub' ? f.stub() : null;
  const cfg = { model, effortReceipt, effortObservation };
  let extractor: CaptureExtractor;
  if (kind === 'vision') extractor = new VisionExtractor(client!, cfg);
  else if (kind === 'ocr+parse') extractor = new OcrThenParseExtractor(client!, f.ocr(env.OCR_ENGINE?.trim() || 'google-vision', env), cfg);
  else extractor = new StubExtractor(stub!.fixtures, stub!.fallback);

  // Matcher tier 4 memakai model ekstraksi (§7.3), effort low.
  const ai: AiMatcher = matcherKind === 'claude' ? new ClaudeAiMatcher(db, client!, { model }) : new StubAiMatcher(stub!.fixtures, stub!.fallback);

  const real = kind !== 'stub';
  return {
    extractor,
    ai,
    verify: () => (client ? verifyClaude(client, model) : Promise.resolve()),
    info: {
      extractor: kind,
      engine: extractor.engine,
      model: real || matcherKind === 'claude' ? model : null,
      effort_receipt: real ? effortReceipt : null,
      effort_observation: real ? effortObservation : null,
      matcher: matcherKind,
    },
  };
}

/**
 * Kunci ditolak (401/403) atau model tidak tersedia (404) → throw (worker tidak start). Jaringan/5xx
 * saat start bukan kesalahan konfigurasi: dicatat `ai.verify_skipped`, worker tetap jalan (§5.4).
 */
export async function verifyClaude(client: WorkerClaude, model: string): Promise<void> {
  try {
    await client.models.retrieve(model);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new Error(`WORKER_ANTHROPIC_API_KEY ditolak Anthropic (${e.status}). Periksa kunci worker (docs/08 §15 no. 5).`);
    }
    if (e instanceof Anthropic.NotFoundError) {
      throw new Error(`EXTRACT_MODEL=${model} tidak tersedia untuk kunci worker (404).`);
    }
    log('ai.verify_skipped', { reason: e instanceof Anthropic.APIError ? `status ${e.status ?? 'koneksi'}` : 'error' });
  }
}
