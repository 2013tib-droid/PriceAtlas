// OcrThenParseExtractor (docs/08 §5.6, D-16 arm `ocr-gcv+opus-low`): OCR khusus → teks + kotak baris
// → Claude (teks saja, gambar tidak dikirim) dengan prompt + skema LLM yang SAMA dengan vision, lalu
// convert.ts yang sama. Dipasang lewat `EXTRACTOR=ocr+parse` (select.ts, 6b M2); diuji L3 dengan OCR
// palsu. Penyempurnaan §5.6 ("dibangun penuh") dan teks privasi F-166 hanya jika D-16 memilihnya.
import type { Extraction } from '@priceatlas/contracts';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { callStructured, maxTokensFor, type ClaudeClient, type StructuredRequest, type StructuredResult } from '../ai/claude.ts';
import { PermanentError, type CaptureExtractor, type CaptureKind, type ExtractContext, type PreparedImage } from '../pipeline/types.ts';
import { llmSchemaFor, type LlmOutput } from './llm-schema.ts';
import { PROMPT_VERSION, ocrNote, systemPrompt } from './prompts/index.ts';
import { finishExtraction, type ExtractInput, type VisionConfig } from './vision.ts';

/** Kotak baris dalam pecahan 0–1 dari lebar/tinggi gambar. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrPage {
  position: number;
  text: string;
  lines: { text: string; box: Box }[];
}

export interface OcrResult {
  pages: OcrPage[];
  /** Biaya vendor OCR (US$) untuk panggilan ini; null jika tidak diketahui. */
  costUsd: number | null;
}

/** Antarmuka vendor OCR (docs/08 §5.6). Error dipetakan seperti Claude: 429/5xx sementara (§5.4). */
export interface OcrEngine {
  readonly name: string;
  recognize(images: PreparedImage[], signal?: AbortSignal): Promise<OcrResult>;
}

const KIND_LABEL: Record<CaptureKind, string> = { receipt: 'struk', price_label: 'label harga', marketplace: 'screenshot belanja online' };

function jakartaDate(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Pesan user: konteks tanggal (§5.2) lalu teks OCR per bagian dengan kotak baris. */
export function buildOcrContent(kind: CaptureKind, pages: OcrPage[], ctx: ExtractContext): BetaContentBlockParam[] {
  const sorted = [...pages].sort((a, b) => a.position - b.position);
  const n = sorted.length;
  const head = [
    `Jenis: ${KIND_LABEL[kind]}.`,
    `Tanggal unggah (Asia/Jakarta): ${jakartaDate(ctx.uploadedAt)}.`,
    ctx.capturedAt ? `Tanggal foto (Asia/Jakarta): ${jakartaDate(ctx.capturedAt)}.` : null,
    `Jumlah ${kind === 'receipt' ? 'bagian' : 'gambar'}: ${n}.`,
    'Input: teks OCR (bukan gambar).',
  ].filter(Boolean);
  const content: BetaContentBlockParam[] = [{ type: 'text', text: head.join(' ') }];
  sorted.forEach((p, i) => {
    const label = kind === 'receipt' ? `Bagian ${i + 1} dari ${n}` : `Gambar ${i + 1} dari ${n}`;
    const body = p.lines.length
      ? p.lines.map((l) => `${l.text} [${r3(l.box.x)},${r3(l.box.y)},${r3(l.box.w)},${r3(l.box.h)}]`).join('\n')
      : p.text || '(OCR tidak menemukan teks)';
    content.push({ type: 'text', text: `${label} (teks OCR)\n${body}` });
  });
  return content;
}

/** Teks OCR mentah semua bagian (rawText; disamarkan job redaksi, §9 lapis 3). */
export function ocrRawText(pages: OcrPage[]): string {
  return [...pages]
    .sort((a, b) => a.position - b.position)
    .map((p) => p.text)
    .join('\n\n');
}

export class OcrThenParseExtractor implements CaptureExtractor {
  readonly promptVersion = PROMPT_VERSION;
  readonly model: string;
  readonly engine: string;

  constructor(
    private readonly client: ClaudeClient,
    private readonly ocr: OcrEngine,
    private readonly cfg: VisionConfig,
  ) {
    this.model = cfg.model;
    this.engine = `${ocr.name}+claude`;
  }

  /** Langkah OCR (dipisah supaya mode batch harness bisa OCR dulu, lalu parse lewat batch). */
  async recognize(input: ExtractInput): Promise<OcrResult> {
    const prepared = [...input.images]
      .sort((a, b) => a.position - b.position)
      .map((img) => {
        if (!img.prepared) throw new PermanentError('unsupported', 'Gambar tidak bisa dibuka. Coba foto ulang atau pilih foto lain.');
        return img.prepared;
      });
    return this.ocr.recognize(prepared, input.ctx.signal);
  }

  request(input: ExtractInput, ocr: OcrResult): StructuredRequest<LlmOutput> {
    const { kind, ctx } = input;
    return {
      model: this.cfg.model,
      effort: kind === 'receipt' ? this.cfg.effortReceipt : this.cfg.effortObservation,
      system: `${systemPrompt(kind)}\n\n${ocrNote()}`,
      content: buildOcrContent(kind, ocr.pages, ctx),
      schema: llmSchemaFor(kind),
      maxTokens: maxTokensFor(ctx.attempt),
      attempt: ctx.attempt,
      signal: ctx.signal,
    };
  }

  finish(input: ExtractInput, ocr: OcrResult, res: StructuredResult<LlmOutput>): Extraction {
    const ex = finishExtraction(input, res, {
      promptVersion: this.promptVersion,
      // §5.3: rawText = teks OCR vendor (utuh sampai redaksi lapis 3, §9).
      rawText: ocrRawText(ocr.pages),
      meta: { ocr_engine: this.ocr.name, ocr_cost_usd: ocr.costUsd },
    });
    // Biaya capture = Claude + vendor OCR (§4.7 "biaya").
    const claude = ex.usage?.costUsd ?? null;
    const total = claude === null || ocr.costUsd === null ? null : Math.round((claude + ocr.costUsd) * 1e6) / 1e6;
    return { ...ex, usage: ex.usage ? { ...ex.usage, costUsd: total } : ex.usage };
  }

  async extract(input: ExtractInput): Promise<Extraction> {
    const ocr = await this.recognize(input);
    return this.finish(input, ocr, await callStructured(this.client, this.request(input, ocr)));
  }
}
