// Klien Claude + OCR PALSU untuk harness (`ocr-eval run --client fake`, test L2): tanpa jaringan dan
// tanpa kunci. Jawaban dibentuk dari ground truth set sintetis (kebalikan convert.ts), dengan gangguan
// deterministik per arm supaya skor, keputusan, dan laporan bisa diuji end-to-end. BUKAN hasil model
// sungguhan: laporan dari klien ini ditandai sintetis dan tidak dipakai untuk D-16.
import { createHash } from 'node:crypto';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ParsedObservation, ParsedReceipt } from '@priceatlas/contracts';
import type { LlmObservation, LlmReceipt } from '../src/extractors/llm-schema.ts';
import type { OcrEngine, OcrResult } from '../src/extractors/ocr-parse.ts';
import { prepareImages } from '../src/images/prepare.ts';
import type { PreparedImage } from '../src/pipeline/types.ts';
import type { ManifestEntry, Truth } from './data.ts';
import { loadImages, type BatchResultLine, type EvalClient } from './run.ts';
import { normalizePayment } from './score.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Bilangan 0–1 deterministik dari kunci. */
function unit(key: string): number {
  return parseInt(sha(key).slice(0, 8), 16) / 0xffffffff;
}

const LLM_PII_KEYS = ['card_last4', 'card_masked', 'phone', 'member_id', 'member_name', 'customer_name', 'email'] as const;

function redactAll(text: string, values: string[]): string {
  let out = text;
  for (const v of values.filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(v).join('[REDAKSI]');
  return out;
}

/** Profil gangguan per arm (bukan klaim tentang model sungguhan). */
function profile(model: string, ocr: boolean) {
  if (model.startsWith('claude-haiku')) return { dropLine: 0.5, amountOff: 0.3, conf: 0.86 };
  if (model.startsWith('claude-sonnet')) return { dropLine: 0.1, amountOff: 0.1, conf: 0.93 };
  if (ocr) return { dropLine: 0.2, amountOff: 0.25, conf: 0.9 };
  return { dropLine: 0, amountOff: 0, conf: 0.97 };
}

export function llmReceiptFromTruth(t: Truth, key: string, model: string, ocr = false): LlmReceipt {
  const exp = t.expected as ParsedReceipt;
  const pf = profile(model, ocr);
  const piiValues = [...Object.values(exp.pii ?? {}), ...t.annotations.transcript_pii];
  let lines = exp.lines.map((l) => ({
    section: 1,
    type: l.line_type,
    text: l.raw_text,
    quantity: l.quantity ?? null,
    unit_price: l.unit_amount ?? null,
    amount: l.line_amount,
    applies_to: l.applies_to_line_no ?? null,
    barcode: l.barcode ?? null,
    member_discount: t.annotations.lines[String(l.line_no)]?.member_discount === true || l.member_discount === true,
    bundle: l.is_bundle === true,
    confidence: pf.conf,
  }));
  const products = lines.map((l, i) => (l.type === 'product' ? i : -1)).filter((i) => i >= 0);
  if (products.length > 1 && unit(`${key}:drop`) < pf.dropLine) {
    const drop = products[products.length - 1]!;
    lines = lines.filter((_, i) => i !== drop).map((l) => ({ ...l, applies_to: l.applies_to && l.applies_to > drop + 1 ? l.applies_to - 1 : l.applies_to }));
  }
  if (products.length && unit(`${key}:amount`) < pf.amountOff) {
    const i = lines.findIndex((l) => l.type === 'product');
    lines[i] = { ...lines[i]!, amount: lines[i]!.amount + 100, confidence: 0.6 };
  }
  const pii = Object.fromEntries(LLM_PII_KEYS.map((k) => [k, null])) as LlmReceipt['pii'];
  for (const [k, v] of Object.entries(exp.pii ?? {})) if ((LLM_PII_KEYS as readonly string[]).includes(k)) pii[k as keyof LlmReceipt['pii']] = v;
  const transcript = [exp.store_hint?.name ?? '', ...exp.lines.map((l) => `${l.raw_text} ${l.line_amount}`), `TOTAL ${exp.header.total_amount ?? ''}`, ...t.annotations.transcript_pii]
    .filter(Boolean)
    .join('\n');
  return {
    document: { type: 'receipt', readable: true, reason: null },
    store: { name: exp.store_hint?.name ?? null, branch: exp.store_hint?.branch_name ?? null, confidence: exp.store_hint?.name ? pf.conf : 0 },
    header: {
      date: exp.header.transaction_date ?? null,
      time: exp.header.transaction_time ?? null,
      total: exp.header.total_amount ?? null,
      subtotal: exp.header.subtotal_amount ?? null,
      payment_method: (normalizePayment(exp.header.payment_method) || null) as LlmReceipt['header']['payment_method'],
      confidence: { date: pf.conf, time: pf.conf, total: pf.conf, subtotal: 0 },
    },
    lines,
    adjustments: (exp.adjustments ?? []).map((a) => ({
      kind: a.kind === 'shipping' ? 'other' : a.kind,
      text: a.description ?? null,
      amount: a.amount ?? null,
      points: a.points ?? null,
    })),
    member: exp.member_hint ? { text: exp.member_hint.text, program: exp.member_hint.program_name ?? null } : null,
    pii,
    // Transkripsi model: PII disamarkan di sumber (§9 lapis 1).
    transcript: redactAll(transcript, piiValues),
  };
}

export function llmObservationFromTruth(t: Truth, key: string, model: string, ocr = false): LlmObservation {
  const exp = t.expected as ParsedObservation;
  const pf = profile(model, ocr);
  return {
    document: { type: exp.kind, readable: true, reason: null },
    store: { name: exp.store_hint?.name ?? null, branch: exp.store_hint?.branch_name ?? null, confidence: exp.store_hint?.name ? pf.conf : 0 },
    items: exp.items.map((i, k) => ({
      image_position: i.image_position ?? 1,
      text: i.raw_text,
      listing_title: i.listing_title ?? null,
      listing_url: i.listing_url ?? null,
      barcode: i.barcode ?? null,
      normal_price: k === 0 && i.normal_price != null && unit(`${key}:price`) < pf.amountOff ? i.normal_price + 500 : (i.normal_price ?? null),
      promo_price: i.promo_price ?? null,
      promo_min_qty: i.promo_min_qty ?? null,
      promo_valid_from: i.promo_valid_from ?? null,
      promo_valid_until: i.promo_valid_until ?? null,
      member_price: i.member_price ?? null,
      member_program: i.member_program_name ?? null,
      seller_name: i.seller_name ?? null,
      seller_ref: i.seller_ref ?? null,
      shipping_fee: i.shipping_fee ?? null,
      shop_voucher: i.shop_voucher ?? null,
      cashback: i.cashback ?? null,
      points: i.points ?? null,
      transaction_date: i.transaction_date ?? null,
      region: i.region ?? null,
      bundle: i.is_bundle === true,
      confidence: { product: pf.conf, price: pf.conf, date: 0 },
    })),
    transcript: exp.items.map((i) => `${i.raw_text} ${i.normal_price ?? ''}`).join('\n'),
  };
}

function unreadable(kind: Truth['kind']): LlmReceipt | LlmObservation {
  const base = { document: { type: kind, readable: false, reason: 'buram' }, store: { name: null, branch: null, confidence: 0 }, transcript: '' };
  if (kind !== 'receipt') return { ...base, items: [] } as LlmObservation;
  return {
    ...base,
    header: { date: null, time: null, total: null, subtotal: null, payment_method: null, confidence: { date: 0, time: 0, total: 0, subtotal: 0 } },
    lines: [], adjustments: [], member: null,
    pii: Object.fromEntries(LLM_PII_KEYS.map((k) => [k, null])) as LlmReceipt['pii'],
  } as LlmReceipt;
}

interface Known {
  entry: ManifestEntry;
  truth: Truth;
}

/** Klien palsu: realtime (`beta.messages.create`) + batch (`beta.messages.batches.*`). */
export class FakeEvalClient implements EvalClient {
  private readonly byImage = new Map<string, Known>();
  private readonly byText = new Map<string, Known>();
  readonly calls: MessageCreateParamsNonStreaming[] = [];
  private readonly batches = new Map<string, { custom_id: string; params: MessageCreateParamsNonStreaming }[]>();

  private constructor() {}

  static async create(dir: string, entries: ManifestEntry[], truths: Truth[]): Promise<FakeEvalClient> {
    const c = new FakeEvalClient();
    for (const entry of entries) {
      const truth = truths.find((t) => t.id === entry.id);
      if (!truth) continue;
      const prepared = await prepareImages(loadImages(dir, entry)).catch(() => [] as PreparedImage[]);
      for (const p of prepared) c.byImage.set(sha(p.data.toString('base64')), { entry, truth });
    }
    return c;
  }

  /** Teks OCR palsu (dicatat supaya pesan teks bisa dipetakan balik ke capture). */
  registerOcrText(text: string, k: Known): void {
    this.byText.set(text, k);
  }

  knownForImage(p: PreparedImage): Known | undefined {
    return this.byImage.get(sha(p.data.toString('base64')));
  }

  private find(params: MessageCreateParamsNonStreaming): Known | undefined {
    const content = params.messages[0]?.content;
    if (!Array.isArray(content)) return undefined;
    for (const b of content) {
      if (b.type === 'image' && b.source.type === 'base64') {
        const k = this.byImage.get(sha(b.source.data));
        if (k) return k;
      }
      if (b.type === 'text') {
        for (const [text, k] of this.byText) if (text && b.text.includes(text)) return k;
      }
    }
    return undefined;
  }

  respond(params: MessageCreateParamsNonStreaming): BetaMessage {
    const k = this.find(params);
    const ocr = !params.messages[0]?.content || (Array.isArray(params.messages[0].content) && !params.messages[0].content.some((b) => b.type === 'image'));
    const key = `${params.model}:${k?.entry.id ?? 'x'}`;
    const json = !k
      ? unreadable('receipt')
      : k.truth.expected === null
        ? unreadable(k.truth.kind)
        : k.truth.kind === 'receipt'
          ? llmReceiptFromTruth(k.truth, key, params.model, ocr)
          : llmObservationFromTruth(k.truth, key, params.model, ocr);
    const parts = k?.entry.images.length ?? 1;
    const receipt = k?.truth.kind === 'receipt';
    return {
      id: `msg_fake_${this.calls.length}`,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content: [{ type: 'text', text: JSON.stringify(json), citations: null }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 2500 + parts * (ocr ? 1500 : receipt ? 3800 : 3400),
        output_tokens: receipt ? 3000 : 1200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: null,
        iterations: null,
      },
    } as unknown as BetaMessage;
  }

  beta = {
    messages: {
      create: async (params: MessageCreateParamsNonStreaming) => {
        this.calls.push(params);
        return this.respond(params);
      },
      batches: {
        create: async (p: { requests: { custom_id: string; params: MessageCreateParamsNonStreaming }[] }) => {
          const id = `msgbatch_fake_${this.batches.size + 1}`;
          if (p.requests.some((r) => 'fallbacks' in r.params)) throw new Error('fallbacks ditolak Batches API (F-116)');
          if (p.requests.some((r) => !/^[A-Za-z0-9_-]{1,64}$/.test(r.custom_id))) throw new Error('custom_id tidak valid');
          this.batches.set(id, p.requests);
          return { id, processing_status: 'in_progress' };
        },
        retrieve: async (id: string) => ({ id, processing_status: 'ended', request_counts: { succeeded: this.batches.get(id)?.length ?? 0 } }),
        results: async (id: string): Promise<AsyncIterable<BatchResultLine>> => {
          const reqs = this.batches.get(id) ?? [];
          const self = this;
          return (async function* () {
            for (const r of [...reqs].reverse()) {
              self.calls.push(r.params);
              yield { custom_id: r.custom_id, result: { type: 'succeeded' as const, message: self.respond(r.params) } };
            }
          })();
        },
      },
    },
  };
}

/** OCR palsu: teks dari ground truth (untuk arm `ocr-gcv+opus-low` dengan klien palsu). */
export class FakeOcr implements OcrEngine {
  readonly name = 'gcv';

  constructor(private readonly client: FakeEvalClient) {}

  async recognize(images: PreparedImage[]): Promise<OcrResult> {
    const pages = images.map((img) => {
      const k = this.client.knownForImage(img);
      const exp = k?.truth.expected;
      const text = !k || !exp
        ? ''
        : exp.kind === 'receipt'
          ? [`#${k.entry.id}`, exp.store_hint?.name ?? '', ...exp.lines.map((l) => `${l.raw_text} ${l.line_amount}`)].join('\n')
          : [`#${k.entry.id}`, ...exp.items.map((i) => `${i.raw_text} ${i.normal_price ?? ''}`)].join('\n');
      if (k && text) this.client.registerOcrText(`#${k.entry.id}`, k);
      return {
        position: img.position,
        text,
        lines: text.split('\n').map((t, i) => ({ text: t, box: { x: 0.05, y: i * 0.05, w: 0.9, h: 0.04 } })),
      };
    });
    return { pages, costUsd: Math.round(images.length * 0.0015 * 1e6) / 1e6 };
  }
}
