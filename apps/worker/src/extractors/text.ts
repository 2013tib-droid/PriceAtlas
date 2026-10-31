// TextExtractor (D-100, docs/08 §23): struk tempelan dari Gemini → kontrak `parsed`, tanpa AI.
// Format tetap (packages/contracts paste.ts, prompt GEMINI_RECEIPT_PROMPT) dibaca parser yang sama
// dengan klien S-21, lalu dipetakan ke skema LLM supaya cek deterministik convert.ts (aritmetika baris,
// diskon menempel, total, jendela tanggal) berlaku sama dengan foto. Biaya selalu 0.
// Dipakai untuk setiap capture `source = 'text'`, apa pun nilai EXTRACTOR.
import { parsePastedReceipt, type Extraction, type PastedReceipt } from '@priceatlas/contracts';
import { PermanentError, type AiMatcher, type CaptureExtractor, type CaptureKind, type ExtractContext, type MatchSuggestion } from '../pipeline/types.ts';
import { convertOutput } from './convert.ts';
import type { LlmReceipt } from './llm-schema.ts';

export const TEXT_ENGINE = 'paste';
export const TEXT_FORMAT_VERSION = 'paste-v1';

/**
 * Confidence "model" untuk setiap field/baris tempelan. Gemini tidak memberi confidence; nilai tetap di
 * bawah 1 supaya auto-save tetap bergantung pada matching dan cek konverter (selama masa kalibrasi
 * τ = 1,01 semua tetap dikonfirmasi, F-172).
 */
export const PASTE_CONFIDENCE = 0.9;

const INVALID = 'Teks tempelan tidak sesuai format. Salin ulang jawaban Gemini lalu tempel lagi.';
const PURGED = 'Teks tempelan sudah dihapus (lebih dari 12 bulan) sehingga tidak bisa diproses ulang.';

/** Format tempelan → skema LLM (convert.ts). Field yang tidak ada di format tempelan diisi netral. */
export function pastedToLlm(r: PastedReceipt, transcript: string): LlmReceipt {
  const c = PASTE_CONFIDENCE;
  return {
    document: { type: 'receipt', readable: true, reason: null },
    store: { name: r.store?.name ?? null, branch: r.store?.branch ?? null, confidence: c },
    header: {
      date: r.date ?? null,
      time: r.time ?? null,
      total: r.total ?? null,
      subtotal: r.subtotal ?? null,
      payment_method: r.payment_method ?? null,
      confidence: { date: c, time: c, total: c, subtotal: c },
    },
    lines: r.lines.map((l) => ({
      section: 1,
      type: l.type,
      text: l.text,
      quantity: l.quantity ?? null,
      unit_price: l.unit_price ?? null,
      amount: l.amount,
      applies_to: l.applies_to ?? null,
      barcode: l.barcode ?? null,
      member_discount: l.member_discount ?? false,
      bundle: false,
      confidence: c,
    })),
    adjustments: (r.adjustments ?? []).map((a) => ({ kind: a.kind, text: a.text ?? null, amount: a.amount ?? null, points: a.points ?? null })),
    member: r.member ? { text: r.member.text, program: r.member.program ?? null } : null,
    // Format tempelan tidak punya field PII (prompt melarangnya); redaksi lapis 2–3 tetap berjalan.
    pii: { card_last4: null, card_masked: null, phone: null, member_id: null, member_name: null, customer_name: null, email: null },
    transcript,
  };
}

export class TextExtractor {
  readonly engine = TEXT_ENGINE;
  readonly model = null;
  readonly promptVersion = TEXT_FORMAT_VERSION;

  extractText(input: { kind: CaptureKind; text: string | null; ctx: ExtractContext }): Extraction {
    if (input.text == null) throw new PermanentError('other', PURGED);
    if (input.kind !== 'receipt') throw new PermanentError('unsupported', INVALID);
    const parsed = parsePastedReceipt(input.text);
    const meta = { engine: TEXT_ENGINE, prompt_version: TEXT_FORMAT_VERSION, kind: input.kind };
    if (!parsed.ok) {
      // Isi teks tidak masuk raw_ai_output (sudah ada di raw_ocr_text, ikut redaksi berkala).
      throw new PermanentError('unsupported', INVALID, {
        rawText: input.text,
        rawOutput: { meta: { ...meta, error: parsed.error, detail: parsed.detail ?? null } },
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      });
    }
    const llm = pastedToLlm(parsed.data, input.text);
    const conv = convertOutput(llm, { kind: 'receipt', uploadedAt: input.ctx.uploadedAt, imageCount: 1 });
    return {
      rawText: input.text,
      output: conv.output,
      rawOutput: { pasted: parsed.data, meta: { ...meta, flags: conv.flags } },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }
}

/** EXTRACTOR=off (D-100): foto tidak diproses. Worker juga hanya mengklaim capture teks (select.ts). */
export class OffExtractor implements CaptureExtractor {
  readonly engine = 'off';
  readonly model = null;
  readonly promptVersion = 'off';

  async extract(): Promise<Extraction> {
    throw new PermanentError('unsupported', 'Pembacaan foto sedang dimatikan. Tempel struk dari Gemini di menu Tempel struk.');
  }
}

/** AI_MATCHER=off (D-100): tanpa tier 4; item tanpa kandidat tier 1–3 dipilih user di S-10. */
export class NoAiMatcher implements AiMatcher {
  async match(): Promise<MatchSuggestion[]> {
    return [];
  }
}
