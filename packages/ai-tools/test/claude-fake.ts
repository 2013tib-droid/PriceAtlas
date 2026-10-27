// Klien Claude palsu untuk Tanya (docs/08 §13.2 L3): respons rekaman sintetis, tanpa jaringan dan
// tanpa kunci API. Diekspor lewat `@priceatlas/ai-tools/testing` untuk test route apps/web.
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { AskClaudeClient, AskFinal } from '../src/ask.ts';

export interface FakeOpts {
  model?: string;
  usage?: Record<string, unknown>;
  /** Blok tambahan di depan konten (mis. blok `fallback`). */
  before?: unknown[];
}

let seq = 0;

function message(content: unknown[], stop_reason: string, opts: FakeOpts = {}): BetaMessage {
  return {
    id: `msg_fake_${++seq}`,
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-opus-5-5',
    content: [...(opts.before ?? []), ...content],
    stop_reason,
    stop_sequence: null,
    stop_details: stop_reason === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      iterations: null,
      ...opts.usage,
    },
  } as unknown as BetaMessage;
}

/** Respons `tool_use` (satu putaran; beberapa tool = paralel). */
export function toolUse(uses: { name: string; input: unknown }[], opts?: FakeOpts): BetaMessage {
  return message(
    [
      { type: 'thinking', thinking: '', signature: 'sig' },
      ...uses.map((u) => ({ type: 'tool_use', id: `toolu_${++seq}`, name: u.name, input: u.input, caller: { type: 'direct' } })),
    ],
    'tool_use',
    opts,
  );
}

/** Jawaban akhir terstruktur (AskFinal sebagai teks JSON). */
export function final(f: Partial<AskFinal> & Pick<AskFinal, 'kind'>, opts?: FakeOpts): BetaMessage {
  const body: AskFinal = { text: '', options: [], ...f };
  return message([{ type: 'text', text: JSON.stringify(body), citations: null }], 'end_turn', opts);
}

export function rawText(text: string, stop_reason = 'end_turn', opts?: FakeOpts): BetaMessage {
  return message([{ type: 'text', text, citations: null }], stop_reason, opts);
}

export function refusal(opts?: FakeOpts): BetaMessage {
  return message([], 'refusal', opts);
}

type Step = BetaMessage | Error | ((params: MessageCreateParamsNonStreaming, signal?: AbortSignal | null) => Promise<BetaMessage>);

export class FakeAskClaude implements AskClaudeClient {
  readonly calls: { params: MessageCreateParamsNonStreaming; signal?: AbortSignal | null }[] = [];
  private readonly steps: Step[];

  constructor(...steps: Step[]) {
    this.steps = steps;
  }

  beta = {
    messages: {
      create: async (params: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal | null }) => {
        // Salinan JSON (yang dikirim ke API): pemanggil menambah `messages` setelah panggilan.
        this.calls.push({ params: JSON.parse(JSON.stringify(params)) as MessageCreateParamsNonStreaming, signal: options?.signal });
        const step = this.steps.shift();
        if (!step) throw new Error('FakeAskClaude: tidak ada respons tersisa');
        if (step instanceof Error) throw step;
        if (typeof step === 'function') return step(params, options?.signal);
        return step;
      },
    },
  };
}

/** Respons yang menunggu sampai signal dibatalkan (untuk tenggat). */
export function hang(): Step {
  return (_p, signal) =>
    new Promise<BetaMessage>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()), { once: true });
    });
}

export const apiError = {
  auth: () => new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', new Headers()),
  badRequest: () => new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 'bad', new Headers()),
  rateLimit: () => new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'rate' } }, 'rate', new Headers()),
  overloaded: () => Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }, 'overloaded', new Headers()),
  connection: () => new Anthropic.APIConnectionError({ message: 'reset' }),
  timeout: () => new Anthropic.APIConnectionTimeoutError(),
};
