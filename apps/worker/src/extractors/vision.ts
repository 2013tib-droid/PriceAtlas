// VisionExtractor (docs/08 §5.1–§5.3): satu panggilan Claude vision per capture, semua gambar urut
// posisi, output skema LLM → convert.ts → kontrak. M0: belum dipasang ke buildDeps (EXTRACTOR tetap
// hanya `stub`); dipakai test L3 dengan klien palsu dan oleh harness/uji live di M1. Dipasang di M2.
import type { Extraction } from '@priceatlas/contracts';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { callStructured, maxTokensFor, type ClaudeClient, type Effort, type StructuredResult } from '../ai/claude.ts';
import { PermanentError, type CaptureExtractor, type CaptureKind, type ExtractContext, type ImageBlob } from '../pipeline/types.ts';
import { convertOutput } from './convert.ts';
import { llmSchemaFor, type LlmOutput } from './llm-schema.ts';
import { PROMPT_VERSION, systemPrompt } from './prompts/index.ts';

export interface VisionConfig {
  model: string;
  effortReceipt: Effort;
  effortObservation: Effort;
}

const KIND_LABEL: Record<CaptureKind, string> = { receipt: 'struk', price_label: 'label harga', marketplace: 'screenshot belanja online' };

function jakartaDate(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Kepala pesan user: jenis, konteks tanggal (§5.2), jumlah bagian/gambar. */
export function contextText(kind: CaptureKind, n: number, ctx: ExtractContext): string {
  return [
    `Jenis: ${KIND_LABEL[kind]}.`,
    `Tanggal unggah (Asia/Jakarta): ${jakartaDate(ctx.uploadedAt)}.`,
    ctx.capturedAt ? `Tanggal foto (Asia/Jakarta): ${jakartaDate(ctx.capturedAt)}.` : null,
    `Jumlah ${kind === 'receipt' ? 'bagian' : 'gambar'}: ${n}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Isi pesan user: kepala lalu "Bagian i dari n" + gambar per posisi. */
export function buildUserContent(kind: CaptureKind, images: ImageBlob[], ctx: ExtractContext): BetaContentBlockParam[] {
  const sorted = [...images].sort((a, b) => a.position - b.position);
  const n = sorted.length;
  const content: BetaContentBlockParam[] = [{ type: 'text', text: contextText(kind, n, ctx) }];
  sorted.forEach((img, i) => {
    const p = img.prepared;
    if (!p) throw new PermanentError('unsupported', 'Gambar tidak bisa dibuka. Coba foto ulang atau pilih foto lain.');
    content.push({ type: 'text', text: kind === 'receipt' ? `Bagian ${i + 1} dari ${n}` : `Gambar ${i + 1} dari ${n}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data.toString('base64') } });
  });
  return content;
}

export class VisionExtractor implements CaptureExtractor {
  readonly engine = 'claude-vision';
  readonly promptVersion = PROMPT_VERSION;
  readonly model: string;

  constructor(
    private readonly client: ClaudeClient,
    private readonly cfg: VisionConfig,
  ) {
    this.model = cfg.model;
  }

  async extract(input: { kind: CaptureKind; images: ImageBlob[]; ctx: ExtractContext }): Promise<Extraction> {
    const { kind, images, ctx } = input;
    const effort = kind === 'receipt' ? this.cfg.effortReceipt : this.cfg.effortObservation;
    const res = await callStructured(this.client, {
      model: this.cfg.model,
      effort,
      system: systemPrompt(kind),
      content: buildUserContent(kind, images, ctx),
      schema: llmSchemaFor(kind),
      maxTokens: maxTokensFor(ctx.attempt),
      attempt: ctx.attempt,
      signal: ctx.signal,
    });
    return toExtraction(res, { kind, uploadedAt: ctx.uploadedAt, imageCount: images.length, promptVersion: this.promptVersion });
  }
}

/**
 * Output LLM → Extraction lewat konverter yang sama untuk vision dan ocr+parse (§4.5: semua arm
 * memakai prompt, skema, dan konverter yang sama). `rawText` default = transkripsi model.
 */
export function toExtraction(
  res: StructuredResult<LlmOutput>,
  opts: { kind: CaptureKind; uploadedAt: Date; imageCount: number; promptVersion: string; rawText?: string; extraMeta?: Record<string, unknown>; extraCostUsd?: number },
): Extraction {
  const { kind } = opts;
  const usage = opts.extraCostUsd
    ? { ...res.usage, costUsd: res.usage.costUsd == null ? null : Math.round((res.usage.costUsd + opts.extraCostUsd) * 1e6) / 1e6 }
    : res.usage;
  const rawOutput = (flags: string[]) => ({
    llm: res.raw,
    meta: { ...res.meta, ...opts.extraMeta, prompt_version: opts.promptVersion, kind, flags },
  });
  try {
    const conv = convertOutput(res.data, { kind, uploadedAt: opts.uploadedAt, imageCount: opts.imageCount });
    return { rawText: opts.rawText ?? conv.rawText, output: conv.output, rawOutput: rawOutput(conv.flags), usage };
  } catch (e) {
    // Bukan struk / buram dll.: output mentah dan biaya tetap tercatat.
    if (e instanceof PermanentError) {
      throw new PermanentError(e.code, e.message, { rawText: opts.rawText ?? res.data.transcript, rawOutput: rawOutput([]), usage });
    }
    throw e;
  }
}
