// Klien palsu harness (docs/08 §13.1): `--client fake` menjalankan alur penuh (init → run → score →
// report) TANPA jaringan, kunci, dan biaya. Respons dibangun dari ground truth (kebalikan konverter)
// dengan derau deterministik per arm, sehingga laporan sintetis punya perbedaan antar-arm. Angka dari
// klien palsu BUKAN hasil uji dan tidak boleh dipakai untuk D-16.
import { createHash } from 'node:crypto';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ParsedObservation, ParsedReceipt } from '@priceatlas/contracts';
import { REDACTED } from '../src/jobs/redact.ts';
import type { LlmObservation, LlmReceipt } from '../src/extractors/llm-schema.ts';
import type { OcrEngine, OcrPage } from '../src/extractors/ocr-parse.ts';
import type { PreparedImage } from '../src/pipeline/types.ts';
import type { BatchClient } from './run.ts';
import { paymentOf } from './score.ts';
import type { Truth } from './truth.ts';

const PAY = ['cash', 'debit', 'credit', 'qris', 'ewallet', 'other'] as const;
const LLM_PII_KEYS = ['card_last4', 'card_masked', 'phone', 'member_id', 'member_name', 'customer_name', 'email'] as const;

export function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Derau per arm (deterministik): model lebih murah → lebih banyak salah baca nominal. */
function noiseFor(model: string, effort: string): { every: number; conf: number } {
  if (model.startsWith('claude-haiku')) return { every: 3, conf: 0.9 };
  if (model.startsWith('claude-sonnet')) return { every: 5, conf: 0.93 };
  if (effort === 'low') return { every: 0, conf: 0.95 };
  return { every: 0, conf: 0.97 };
}

function transcriptOf(lines: string[], pii: string[]): string {
  let text = lines.join('\n');
  for (const v of pii.filter((x) => x.length >= 4)) text = text.split(v).join(REDACTED);
  return text;
}

export function llmFromTruth(truth: Truth, model: string, effort: string): LlmReceipt | LlmObservation {
  const exp = truth.expected;
  const { every, conf } = noiseFor(model, effort);
  if (!exp) {
    // Gambar yang tidak terbaca oleh manusia: model (palsu) juga menyatakan tidak terbaca.
    const document = { type: truth.kind, readable: false, reason: 'buram' } as const;
    const store = { name: null, branch: null, confidence: 0 };
    if (truth.kind !== 'receipt') return { document, store, items: [], transcript: '' };
    return {
      document,
      store,
      header: { date: null, time: null, total: null, subtotal: null, payment_method: null, confidence: { date: 0, time: 0, total: 0, subtotal: 0 } },
      lines: [],
      adjustments: [],
      member: null,
      pii: { card_last4: null, card_masked: null, phone: null, member_id: null, member_name: null, customer_name: null, email: null },
      transcript: '',
    };
  }
  if (exp.kind === 'receipt') return llmReceipt(exp, truth, every, conf);
  return llmObservation(exp, every, conf);
}

function llmReceipt(exp: ParsedReceipt, truth: Truth, every: number, conf: number): LlmReceipt {
  const idx = new Map(exp.lines.map((l, i) => [l.line_no, i + 1]));
  let product = 0;
  const lines = exp.lines.map((l) => {
    const noisy = l.line_type === 'product' && every > 0 && ++product % every === 0;
    return {
      section: 1,
      type: l.line_type,
      text: l.raw_text,
      quantity: l.quantity ?? null,
      unit_price: noisy ? null : (l.unit_amount ?? null),
      amount: noisy ? l.line_amount + 100 : l.line_amount,
      applies_to: l.applies_to_line_no != null ? (idx.get(l.applies_to_line_no) ?? null) : null,
      barcode: l.barcode ?? null,
      member_discount: !!(l.member_discount ?? truth.annotations.lines[String(l.line_no)]?.member_discount),
      bundle: !!l.is_bundle,
      confidence: noisy ? 0.6 : conf,
    };
  });
  const pay = paymentOf(exp.header.payment_method);
  const pii = Object.fromEntries(LLM_PII_KEYS.map((k) => [k, exp.pii[k] ?? null])) as LlmReceipt['pii'];
  const piiValues = [...Object.values(exp.pii), ...truth.annotations.transcript_pii];
  return {
    document: { type: 'receipt', readable: true, reason: null },
    store: { name: exp.store_hint?.name ?? null, branch: exp.store_hint?.branch_name ?? null, confidence: conf },
    header: {
      date: exp.header.transaction_date ?? null,
      time: exp.header.transaction_time ?? null,
      total: exp.header.total_amount ?? null,
      subtotal: exp.header.subtotal_amount ?? null,
      payment_method: PAY.find((p) => p === pay) ?? (pay ? 'other' : null),
      confidence: { date: conf, time: conf, total: conf, subtotal: exp.header.subtotal_amount != null ? conf : 0 },
    },
    lines,
    adjustments: exp.adjustments.map((a) => ({
      kind: a.kind === 'shipping' ? 'other' : a.kind,
      text: a.description ?? null,
      amount: a.amount ?? null,
      points: a.points ?? null,
    })),
    member: exp.member_hint ? { text: exp.member_hint.text, program: exp.member_hint.program_name ?? null } : null,
    pii,
    transcript: transcriptOf(
      [exp.store_hint?.name ?? '', ...exp.lines.map((l) => `${l.raw_text} ${l.line_amount}`), `TOTAL ${exp.header.total_amount ?? ''}`, ...piiValues],
      piiValues,
    ),
  };
}

function llmObservation(exp: ParsedObservation, every: number, conf: number): LlmObservation {
  return {
    document: { type: exp.kind, readable: true, reason: null },
    store: { name: exp.store_hint?.name ?? null, branch: exp.store_hint?.branch_name ?? null, confidence: exp.store_hint?.name ? conf : 0 },
    items: exp.items.map((it, i) => {
      const noisy = every > 0 && (i + 1) % every === 0;
      return {
        image_position: it.image_position ?? 1,
        text: it.raw_text,
        listing_title: it.listing_title ?? null,
        listing_url: it.listing_url ?? null,
        barcode: it.barcode ?? null,
        normal_price: noisy && it.normal_price != null ? it.normal_price + 100 : (it.normal_price ?? null),
        promo_price: it.promo_price ?? null,
        promo_min_qty: it.promo_min_qty ?? null,
        promo_valid_from: it.promo_valid_from ?? null,
        promo_valid_until: it.promo_valid_until ?? null,
        member_price: it.member_price ?? null,
        member_program: it.member_program_name ?? null,
        seller_name: it.seller_name ?? null,
        seller_ref: it.seller_ref ?? null,
        shipping_fee: it.shipping_fee ?? null,
        shop_voucher: it.shop_voucher ?? null,
        cashback: it.cashback ?? null,
        points: it.points ?? null,
        transaction_date: it.transaction_date ?? null,
        region: it.region ?? null,
        bundle: !!it.is_bundle,
        confidence: { product: conf, price: noisy ? 0.6 : conf, date: 0 },
      };
    }),
    transcript: exp.items.map((i) => `${i.raw_text} ${i.normal_price ?? ''}`).join('\n'),
  };
}

export function fakeMessage(json: unknown, model: string, nImages: number, nLines: number): BetaMessage {
  return {
    id: `msg_fake_${sha(JSON.stringify(json)).slice(0, 8)}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: JSON.stringify(json), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 2500 + 1600 * nImages,
      output_tokens: 600 + 80 * nLines,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      iterations: null,
    },
  } as unknown as BetaMessage;
}

/** Penanda id di teks OCR palsu, supaya klien palsu tahu capture mana (arm ocr). */
export const OCR_MARK = /\[fake-ocr:([^\]]+)\]/;

export class FakeOcr implements OcrEngine {
  readonly name = 'gcv';
  readonly costPerImageUsd = 0.0015;
  constructor(private readonly idOf: (img: PreparedImage) => string | undefined) {}

  async recognize(images: PreparedImage[]): Promise<OcrPage[]> {
    return images.map((img) => {
      const id = this.idOf(img) ?? 'unknown';
      const text = `[fake-ocr:${id}]`;
      return { position: img.position, text, lines: [{ text, box: { x: 0, y: 0, w: 1, h: 0.05 } }] };
    });
  }
}

/**
 * Klien Claude palsu dengan bentuk yang sama seperti SDK (`beta.messages.create` + `batches`).
 * Capture dikenali dari sha256 data gambar base64 (vision) atau penanda OCR (ocr+parse).
 */
export class FakeEvalClient implements BatchClient {
  readonly calls: number[] = [];
  readonly batchStore = new Map<string, { custom_id: string; params: MessageCreateParamsNonStreaming }[]>();

  constructor(
    private readonly truths: Map<string, Truth>,
    private readonly idByImageSha: Map<string, string>,
  ) {}

  private respond(params: MessageCreateParamsNonStreaming): BetaMessage {
    const content = params.messages[0]?.content;
    const blocks = Array.isArray(content) ? content : [];
    let id: string | undefined;
    let nImages = 0;
    for (const b of blocks) {
      if (b.type === 'image' && b.source.type === 'base64') {
        nImages += 1;
        id ??= this.idByImageSha.get(sha(b.source.data));
      }
      if (b.type === 'text') id ??= b.text.match(OCR_MARK)?.[1];
    }
    const truth = id ? this.truths.get(id) : undefined;
    if (!truth) throw new Error('FakeEvalClient: capture tidak dikenal');
    const effort = (params.output_config as { effort?: string } | undefined)?.effort ?? 'medium';
    const json = llmFromTruth(truth, params.model, effort);
    const n = 'lines' in json ? json.lines.length : json.items.length;
    return fakeMessage(json, params.model, Math.max(1, nImages), n);
  }

  beta = {
    messages: {
      create: async (params: MessageCreateParamsNonStreaming) => {
        this.calls.push(Date.now());
        return this.respond(params);
      },
      batches: {
        create: async (body: { requests: { custom_id: string; params: MessageCreateParamsNonStreaming }[] }) => {
          const id = `msgbatch_fake_${this.batchStore.size + 1}`;
          this.batchStore.set(id, body.requests);
          return { id, processing_status: 'in_progress' as const, request_counts: { processing: body.requests.length, succeeded: 0, errored: 0, canceled: 0, expired: 0 } };
        },
        retrieve: async (id: string) => {
          const n = this.batchStore.get(id)?.length ?? 0;
          return { id, processing_status: 'ended' as const, request_counts: { processing: 0, succeeded: n, errored: 0, canceled: 0, expired: 0 } };
        },
        results: async (id: string) => {
          const reqs = this.batchStore.get(id) ?? [];
          const respond = (p: MessageCreateParamsNonStreaming) => this.respond(p);
          return (async function* () {
            // Urutan hasil batch tidak dijamin: dibalik supaya harness wajib memetakan lewat custom_id.
            for (const r of [...reqs].reverse()) yield { custom_id: r.custom_id, result: { type: 'succeeded' as const, message: respond(r.params) } };
          })();
        },
      },
    },
  };
}
