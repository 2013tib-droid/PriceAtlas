// VisionExtractor (docs/08 §5.1–§5.3): satu panggilan Claude vision per capture, semua gambar urut
// posisi, output skema LLM → convert.ts → kontrak. Dipasang lewat `EXTRACTOR=vision` (select.ts, 6b M2);
// juga dipakai harness dan uji live (M1).
import type { Extraction } from '@priceatlas/contracts';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { callStructured, maxTokensFor, type ClaudeClient, type Effort, type StructuredRequest, type StructuredResult } from '../ai/claude.ts';
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

/** Isi pesan user: konteks tanggal (§5.2) lalu "Bagian i dari n" + gambar per posisi. */
export function buildUserContent(kind: CaptureKind, images: ImageBlob[], ctx: ExtractContext): BetaContentBlockParam[] {
  const sorted = [...images].sort((a, b) => a.position - b.position);
  const n = sorted.length;
  const head = [
    `Jenis: ${KIND_LABEL[kind]}.`,
    `Tanggal unggah (Asia/Jakarta): ${jakartaDate(ctx.uploadedAt)}.`,
    ctx.capturedAt ? `Tanggal foto (Asia/Jakarta): ${jakartaDate(ctx.capturedAt)}.` : null,
    `Jumlah ${kind === 'receipt' ? 'bagian' : 'gambar'}: ${n}.`,
  ].filter(Boolean);
  const content: BetaContentBlockParam[] = [{ type: 'text', text: head.join(' ') }];
  sorted.forEach((img, i) => {
    const p = img.prepared;
    if (!p) throw new PermanentError('unsupported', 'Gambar tidak bisa dibuka. Coba foto ulang atau pilih foto lain.');
    content.push({ type: 'text', text: kind === 'receipt' ? `Bagian ${i + 1} dari ${n}` : `Gambar ${i + 1} dari ${n}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data.toString('base64') } });
  });
  return content;
}

export type ExtractInput = { kind: CaptureKind; images: ImageBlob[]; ctx: ExtractContext };

/** LLM → kontrak (convert.ts) + rawOutput `{ llm, meta }`; error permanen tetap membawa output mentah. */
export function finishExtraction(
  input: ExtractInput,
  res: StructuredResult<LlmOutput>,
  extra: { promptVersion: string; rawText?: string; meta?: Record<string, unknown> },
): Extraction {
  const { kind, images, ctx } = input;
  const rawOutput = (flags: string[]) => ({
    llm: res.raw,
    meta: { ...res.meta, ...extra.meta, prompt_version: extra.promptVersion, kind, flags },
  });
  try {
    const conv = convertOutput(res.data, { kind, uploadedAt: ctx.uploadedAt, imageCount: images.length });
    return { rawText: extra.rawText ?? conv.rawText, output: conv.output, rawOutput: rawOutput(conv.flags), usage: res.usage };
  } catch (e) {
    // Bukan struk / buram dll.: output mentah dan biaya tetap tercatat.
    if (e instanceof PermanentError) {
      throw new PermanentError(e.code, e.message, {
        rawText: extra.rawText ?? res.data.transcript,
        rawOutput: rawOutput([]),
        usage: res.usage,
      });
    }
    throw e;
  }
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

  /** Permintaan Claude untuk capture ini (dipakai juga mode batch harness). */
  request(input: ExtractInput): StructuredRequest<LlmOutput> {
    const { kind, images, ctx } = input;
    return {
      model: this.cfg.model,
      effort: kind === 'receipt' ? this.cfg.effortReceipt : this.cfg.effortObservation,
      system: systemPrompt(kind),
      content: buildUserContent(kind, images, ctx),
      schema: llmSchemaFor(kind),
      maxTokens: maxTokensFor(ctx.attempt),
      attempt: ctx.attempt,
      signal: ctx.signal,
    };
  }

  finish(input: ExtractInput, res: StructuredResult<LlmOutput>): Extraction {
    return finishExtraction(input, res, { promptVersion: this.promptVersion });
  }

  async extract(input: ExtractInput): Promise<Extraction> {
    return this.finish(input, await callStructured(this.client, this.request(input)));
  }
}
