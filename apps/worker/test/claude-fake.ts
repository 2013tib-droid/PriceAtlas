// Klien Claude palsu (docs/08 §13.2): respons rekaman sintetis, tanpa jaringan dan tanpa kunci API.
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ClaudeClient } from '../src/ai/claude.ts';
import type { LlmObservation, LlmReceipt } from '../src/extractors/llm-schema.ts';

export interface FakeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  iterations?: unknown[];
}

/** Respons Messages API (bentuk minimal yang dibaca worker). */
export function fakeMessage(opts: {
  json?: unknown;
  text?: string;
  stop_reason?: string;
  model?: string;
  usage?: FakeUsage;
  extraContent?: unknown[];
}): BetaMessage {
  const text = opts.text ?? JSON.stringify(opts.json ?? {});
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-opus-5-5',
    content: [...(opts.extraContent ?? []), { type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text, citations: null }],
    stop_reason: opts.stop_reason ?? 'end_turn',
    stop_sequence: null,
    stop_details: opts.stop_reason === 'refusal' ? { type: 'refusal', category: 'cyber', explanation: null } : null,
    usage: {
      input_tokens: 3000,
      output_tokens: 1000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      iterations: null,
      ...opts.usage,
    },
  } as unknown as BetaMessage;
}

type Step = BetaMessage | Error | ((params: MessageCreateParamsNonStreaming, signal?: AbortSignal | null) => Promise<BetaMessage>);

export class FakeClaude implements ClaudeClient {
  readonly calls: { params: MessageCreateParamsNonStreaming; signal?: AbortSignal | null }[] = [];
  private readonly steps: Step[];

  constructor(...steps: Step[]) {
    this.steps = steps;
  }

  push(...steps: Step[]) {
    this.steps.push(...steps);
  }

  beta = {
    messages: {
      create: async (params: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal | null }) => {
        this.calls.push({ params, signal: options?.signal });
        const step = this.steps.shift();
        if (!step) throw new Error('FakeClaude: tidak ada respons tersisa');
        if (step instanceof Error) throw step;
        if (typeof step === 'function') return step(params, options?.signal);
        return step;
      },
    },
  };
}

export const apiError = {
  rateLimit: () => new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'rate' } }, 'rate', new Headers()),
  overloaded: () => Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }, 'overloaded', new Headers()),
  server: () => new Anthropic.InternalServerError(500, { type: 'error', error: { type: 'api_error', message: 'boom' } }, 'boom', new Headers()),
  connection: () => new Anthropic.APIConnectionError({ message: 'reset' }),
  timeout: () => new Anthropic.APIConnectionTimeoutError(),
  abort: () => new Anthropic.APIUserAbortError(),
  badImage: () =>
    new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Could not process image' } }, 'bad', new Headers()),
  badParam: () =>
    new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: too large' } }, 'bad', new Headers()),
  auth: () => new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'auth', new Headers()),
  permission: () => new Anthropic.PermissionDeniedError(403, { type: 'error', error: { type: 'permission_error', message: 'no' } }, 'perm', new Headers()),
  notFound: () => new Anthropic.NotFoundError(404, { type: 'error', error: { type: 'not_found_error', message: 'model' } }, 'nf', new Headers()),
  tooLarge: () => Anthropic.APIError.generate(413, { type: 'error', error: { type: 'request_too_large', message: 'big' } }, 'big', new Headers()),
};

// ------------------------------------------------ respons rekaman sintetis (isi gambar fixture)

/** struk-aeon.jpg dibaca dengan benar (cocok dengan fixture stub). */
export function llmStrukAeon(): LlmReceipt {
  return {
    document: { type: 'receipt', readable: true, reason: null },
    store: { name: 'AEON', branch: 'BSD', confidence: 0.96 },
    header: {
      date: '2026-10-15',
      time: '19:02',
      total: 114700,
      subtotal: null,
      payment_method: 'debit',
      confidence: { date: 0.98, time: 0.95, total: 0.99, subtotal: 0 },
    },
    lines: [
      { section: 1, type: 'product', text: 'MILO ORI 500G', quantity: 2, unit_price: 45000, amount: 90000, applies_to: null, barcode: '8992696404441', member_discount: false, bundle: false, confidence: 0.97 },
      { section: 1, type: 'discount', text: 'DISC MEMBER', quantity: null, unit_price: null, amount: -5000, applies_to: 1, barcode: null, member_discount: true, bundle: false, confidence: 0.95 },
      { section: 1, type: 'product', text: 'INDOMIE GRG 85G', quantity: 5, unit_price: 3500, amount: 17500, applies_to: null, barcode: null, member_discount: false, bundle: false, confidence: 0.96 },
      { section: 1, type: 'non_product', text: 'KANTONG PLASTIK', quantity: null, unit_price: null, amount: 200, applies_to: null, barcode: null, member_discount: false, bundle: false, confidence: 0.9 },
      { section: 1, type: 'product', text: 'SNACK XYZ', quantity: null, unit_price: null, amount: 12000, applies_to: null, barcode: null, member_discount: false, bundle: false, confidence: 0.93 },
    ],
    adjustments: [],
    member: { text: 'MEMBER', program: null },
    pii: { card_last4: '4321', card_masked: '****4321', phone: '081298765432', member_id: null, member_name: null, customer_name: null, email: null },
    transcript:
      'AEON BSD\nAEON STORE BSD CITY\nJL. BSD RAYA UTAMA\n15/10/2026 19:02 KS:03\nMILO ORI 500G 2 x 45.000 90.000\n8992696404441\nDISC MEMBER -5.000\nINDOMIE GRG 85G 5 x 3.500 17.500\nKANTONG PLASTIK 200\nSNACK XYZ 12.000\nTOTAL 114.700\nDEBIT [REDAKSI] 114.700\nMEMBER HP [REDAKSI]\nTERIMA KASIH',
  };
}

/** label-milo.jpg: dua label (promo berperiode + harga member). */
export function llmLabelMilo(): LlmObservation {
  const base = {
    listing_title: null, listing_url: null, promo_min_qty: null, promo_valid_from: null, seller_name: null, seller_ref: null,
    shipping_fee: null, shop_voucher: null, cashback: null, points: null, transaction_date: null, bundle: false,
  };
  return {
    document: { type: 'price_label', readable: true, reason: null },
    store: { name: null, branch: null, confidence: 0 },
    items: [
      {
        ...base, image_position: 1, text: 'MILO ORIGINAL 200G', barcode: '8992696404442', normal_price: 19500, promo_price: 17500,
        promo_valid_until: '2099-12-31', member_price: null, member_program: null,
        region: { x: 0.05, y: 0.1, w: 0.42, h: 0.8 }, confidence: { product: 0.98, price: 0.97, date: 0 },
      },
      {
        ...base, image_position: 1, text: 'MILO 3IN1 10X35G', barcode: null, normal_price: 23000, promo_price: null,
        promo_valid_until: null, member_price: 21000, member_program: 'AEON Member',
        region: { x: 0.52, y: 0.1, w: 0.42, h: 0.8 }, confidence: { product: 0.97, price: 0.95, date: 0 },
      },
    ],
    transcript: 'MILO ORIGINAL 200G\n8992696404442\nRp19.500\nPROMO Rp17.500\ns/d 31 Des 2099\n\nMILO 3IN1 10X35G\nRp23.000\nAEON Member\nMEMBER Rp21.000',
  };
}
