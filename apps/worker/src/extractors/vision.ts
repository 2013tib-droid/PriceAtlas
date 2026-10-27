// VisionExtractor (docs/08 §5.1–§5.3): satu panggilan Claude vision per capture, semua gambar urut
// posisi, output skema LLM → convert.ts → kontrak. M0: belum dipasang ke buildDeps (EXTRACTOR tetap
// hanya `stub`); dipakai test L3 dengan klien palsu dan oleh harness/uji live di M1. Dipasang di M2.
import type { Extraction } from '@priceatlas/contracts';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { callStructured, maxTokensFor, type ClaudeClient, type Effort } from '../ai/claude.ts';
import { PermanentError, type CaptureExtractor, type CaptureKind, type ExtractContext, type ImageBlob } from '../pipeline/types.ts';
import { convertOutput } from './convert.ts';
import { llmSchemaFor } from './llm-schema.ts';
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
    const rawOutput = (flags: string[]) => ({ llm: res.raw, meta: { ...res.meta, prompt_version: this.promptVersion, kind, flags } });
    try {
      const conv = convertOutput(res.data, { kind, uploadedAt: ctx.uploadedAt, imageCount: images.length });
      return { rawText: conv.rawText, output: conv.output, rawOutput: rawOutput(conv.flags), usage: res.usage };
    } catch (e) {
      // Bukan struk / buram dll.: output mentah dan biaya tetap tercatat.
      if (e instanceof PermanentError) {
        throw new PermanentError(e.code, e.message, { rawText: res.data.transcript, rawOutput: rawOutput([]), usage: res.usage });
      }
      throw e;
    }
  }
}
