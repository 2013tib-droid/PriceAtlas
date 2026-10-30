// StubExtractor + StubAiMatcher (docs/05 §5.4): deterministik, tanpa jaringan (D-16).
// Fixture JSON di direktori fixture dipetakan ke gambar lewat sha256 gambar posisi 1:
//   * <sha256>.json, atau
//   * <nama>.json berisi "images": ["<file gambar di direktori yang sama>", ...]
// Bentuk fixture:
//   {
//     "images": ["struk-aeon.jpg"],
//     "raw_text": "teks OCR mentah (opsional)",
//     "output": ParsedReceipt | ParsedObservation,
//     "failures": [{ "type": "transient" } | { "type": "permanent", "code": "blurry", "message": "..." }],
//     "ai_matches": { "<raw_text>": { "product_id": "<uuid>", "confidence": 0.8 } },
//     "usage": { "inputTokens": 0, "outputTokens": 0, "costUsd": 0 }
//   }
// failures[n-1] dipakai pada percobaan ke-n (attempt). Tanpa fixture → PermanentError('unsupported').
// Mode fallback KHUSUS e2e (docs/08 §13.2, Q-82, Q-118 → D-92): `fallback` = nama fixture yang dipakai
// untuk gambar yang tidak dikenal (frame kamera palsu Chromium, F-63), hanya jika jenis capture sama
// dengan jenis output fixture itu. Tidak pernah default: hanya lewat env STUB_FALLBACK_FIXTURE.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureKind, Extraction, ParsedOutput } from '@priceatlas/contracts';
import {
  PermanentError,
  TransientError,
  type AiMatcher,
  type CaptureExtractor,
  type ExtractContext,
  type ImageBlob,
  type MatchContext,
  type MatchSuggestion,
  type PermanentCode,
  type UnmatchedItem,
} from '../pipeline/types.ts';

export interface StubFixture {
  name: string;
  images?: string[];
  raw_text?: string;
  output: ParsedOutput;
  failures?: ({ type: 'transient'; message?: string } | { type: 'permanent'; code: PermanentCode; message?: string })[];
  ai_matches?: Record<string, { product_id: string; confidence: number }>;
  usage?: Extraction['usage'];
}

export class FixtureRegistry {
  private readonly bySha = new Map<string, StubFixture>();

  constructor(readonly dir: string) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const fx = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Omit<StubFixture, 'name'>;
      const name = file.replace(/\.json$/, '');
      const fixture: StubFixture = { ...fx, name };
      if (/^[0-9a-f]{64}$/.test(name)) {
        this.bySha.set(name, fixture);
      } else if (fx.images?.[0]) {
        this.bySha.set(sha256(readFileSync(join(dir, fx.images[0]))), fixture);
      }
    }
  }

  get(sha: string): StubFixture | undefined {
    return this.bySha.get(sha);
  }

  /** Fixture untuk gambar posisi 1, atau fixture fallback (jenis sama) jika gambar tidak dikenal. */
  resolve(sha: string | undefined, kind: CaptureKind, fallback: StubFixture | null): StubFixture | undefined {
    const hit = sha ? this.bySha.get(sha) : undefined;
    if (hit) return hit;
    return fallback && fallback.output.kind === kind ? fallback : undefined;
  }

  /** Nama fixture → fixture (untuk skrip dev dan test). */
  byName(name: string): StubFixture | undefined {
    return [...this.bySha.values()].find((f) => f.name === name);
  }
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Fixture fallback dari nama (STUB_FALLBACK_FIXTURE); nama tidak dikenal → error saat start. */
export function fallbackFixture(fixtures: FixtureRegistry, name: string | undefined): StubFixture | null {
  if (!name) return null;
  const fx = fixtures.byName(name);
  if (!fx) throw new Error(`STUB_FALLBACK_FIXTURE=${name}: fixture tidak ada di ${fixtures.dir}`);
  return fx;
}

export class StubExtractor implements CaptureExtractor {
  readonly engine = 'stub';
  readonly model = null;
  readonly promptVersion = 'stub-1';

  constructor(
    private readonly fixtures: FixtureRegistry,
    private readonly fallback: StubFixture | null = null,
  ) {}

  async extract(input: { kind: CaptureKind; images: ImageBlob[]; ctx: ExtractContext }): Promise<Extraction> {
    const first = [...input.images].sort((a, b) => a.position - b.position)[0];
    const fx = this.fixtures.resolve(first?.sha256, input.kind, this.fallback);
    if (!fx) throw new PermanentError('unsupported', 'Format gambar ini belum didukung.');

    const failure = fx.failures?.[input.ctx.attempt - 1];
    if (failure?.type === 'transient') throw new TransientError(failure.message ?? 'stub: gangguan sementara');
    if (failure?.type === 'permanent') throw new PermanentError(failure.code, failure.message ?? '');

    return { rawText: fx.raw_text ?? null, output: fx.output, usage: fx.usage };
  }
}

export class StubAiMatcher implements AiMatcher {
  constructor(
    private readonly fixtures: FixtureRegistry,
    private readonly fallback: StubFixture | null = null,
  ) {}

  async match(items: UnmatchedItem[], ctx: MatchContext): Promise<MatchSuggestion[]> {
    const fx = this.fixtures.resolve(ctx.imageSha256s[0], ctx.kind, this.fallback);
    const table = fx?.ai_matches ?? {};
    return items.flatMap((it) => {
      const hit = table[it.raw_text];
      return hit ? [{ key: it.key, product_id: hit.product_id, confidence: hit.confidence }] : [];
    });
  }
}
