// Pemanggil Claude untuk worker dan harness (docs/08 §3.1, §5.2, §5.4). Satu tempat supaya harness
// mengukur kode yang sama dengan produksi.
//   * Client: timeout 120 dtk, maxRetries 1 (F-107). Retry panjang hanya lewat pipeline (D-70).
//   * Tenggat: AbortSignal dari pipeline (lease − 30 dtk sejak claim).
//   * Structured outputs (`output_config.format`, F-108), bukan tool use. Server-side fallback
//     `fallbacks: 'default'` untuk refusal klasifikator yang keliru (selain Haiku).
//   * `stop_reason` diperiksa sebelum output dipakai; output divalidasi zod di sini.
// Helper `beta.messages.parse` tidak dipakai: ia melempar AnthropicError saat JSON tidak lolos skema
// atau terpotong (max_tokens), sebelum stop_reason bisa diperiksa dan tanpa teks mentah untuk audit.
// Jadi jalur cadangan §5.2: `beta.messages.create` + skema dari `betaZodOutputFormat` + zod manual (F-123).
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type {
  BetaContentBlockParam,
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import type { z } from 'zod';
import type { Extraction } from '@priceatlas/contracts';
import { log } from '../log.ts';
import { PermanentError, TransientError, type RunOutput } from '../pipeline/types.ts';
import { costUsd, totalInputTokens } from './pricing.ts';

export const CLAUDE_TIMEOUT_MS = 120_000;
export const CLAUDE_MAX_RETRIES = 1;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type Effort = 'low' | 'medium' | 'high';

/** Bagian client yang dipakai worker; test memakai klien palsu dengan bentuk yang sama. */
export interface ClaudeClient {
  beta: { messages: { create(params: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal | null }): PromiseLike<BetaMessage> } };
}

export function createClaudeClient(opts: { apiKey?: string } = {}): Anthropic {
  return new Anthropic({ apiKey: opts.apiKey, timeout: CLAUDE_TIMEOUT_MS, maxRetries: CLAUDE_MAX_RETRIES });
}

/** Haiku 5.5 tidak punya server-side fallback untuk refusal (docs/08 §1.3). */
export function supportsServerFallback(model: string): boolean {
  return !model.startsWith('claude-haiku');
}

/** Percobaan setelah `max_tokens` diberi batas dua kali lipat (§5.4). */
export function maxTokensFor(attempt: number, base = 16_000): number {
  return attempt > 1 ? base * 2 : base;
}

export interface StructuredRequest<T> {
  model: string;
  effort: Effort;
  system: string;
  content: BetaContentBlockParam[];
  schema: z.ZodType<T>;
  maxTokens: number;
  /** Percobaan pipeline (1-based): `max_tokens` di percobaan pertama = sementara, sesudahnya permanen. */
  attempt: number;
  signal?: AbortSignal;
}

export interface CallMeta {
  requested_model: string;
  served_model: string;
  fallback_used: boolean;
  stop_reason: string | null;
  effort: Effort;
  max_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export interface StructuredResult<T> {
  data: T;
  /** JSON mentah dari model (sebelum konversi), untuk raw_ai_output. */
  raw: unknown;
  meta: CallMeta;
  usage: NonNullable<Extraction['usage']>;
}

/** Batch (harness, F-116): parameter sama dengan panggilan biasa, tanpa `fallbacks` (ditolak Batches API). */
export function buildBatchParams<T>(req: StructuredRequest<T>): MessageCreateParamsNonStreaming {
  const { betas: _betas, fallbacks: _fallbacks, ...params } = buildParams(req);
  return params;
}

export function buildParams<T>(req: StructuredRequest<T>): MessageCreateParamsNonStreaming {
  const params: MessageCreateParamsNonStreaming = {
    model: req.model,
    max_tokens: req.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: req.content }],
  };
  if (supportsServerFallback(req.model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

export async function callStructured<T>(client: ClaudeClient, req: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const params = buildParams(req);
  let msg: BetaMessage;
  try {
    msg = await client.beta.messages.create(params, { signal: req.signal });
  } catch (e) {
    throw mapClaudeError(e, req.signal);
  }

  return interpretMessage(req, msg);
}

/**
 * Respons Messages API → hasil terstruktur (dipakai panggilan biasa dan hasil batch harness): cek
 * `stop_reason` dulu (refusal, max_tokens), lalu JSON + zod. Error membawa output mentah (F-127).
 */
export function interpretMessage<T>(req: StructuredRequest<T>, msg: BetaMessage): StructuredResult<T> {
  const meta = metaOf(req, msg);
  const usage = { inputTokens: meta.input_tokens, outputTokens: meta.output_tokens, costUsd: meta.cost_usd };
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const runOutput = (raw: unknown): RunOutput => ({ rawText: null, rawOutput: { llm: raw, meta }, usage });

  if (msg.stop_reason === 'refusal') {
    log('ai.refusal', { model: meta.served_model, category: msg.stop_details?.category ?? null });
    throw new PermanentError('other', 'Gambar tidak bisa diproses.', runOutput({ text }));
  }
  if (msg.stop_reason === 'max_tokens') {
    log('ai.max_tokens', { model: meta.served_model, attempt: req.attempt, max_tokens: req.maxTokens });
    const ro = runOutput({ text });
    if (req.attempt <= 1) throw new TransientError('ai: max_tokens', ro);
    throw new PermanentError('other', 'Struk terlalu panjang untuk dibaca. Coba foto per bagian.', ro);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PermanentError('unsupported', 'Hasil pembacaan gambar tidak valid.', runOutput({ text }));
  }
  const parsed = req.schema.safeParse(json);
  if (!parsed.success) {
    log('ai.schema_invalid', { model: meta.served_model, issues: parsed.error.issues.length });
    throw new PermanentError('unsupported', 'Hasil pembacaan gambar tidak valid.', runOutput(json));
  }
  return { data: parsed.data, raw: json, meta, usage };
}

function metaOf(req: StructuredRequest<unknown>, msg: BetaMessage): CallMeta {
  const fallbackUsed =
    msg.content.some((b) => b.type === 'fallback') || (msg.usage.iterations ?? []).some((i) => i.type === 'fallback_message');
  return {
    requested_model: req.model,
    served_model: msg.model,
    fallback_used: fallbackUsed,
    stop_reason: msg.stop_reason,
    effort: req.effort,
    max_tokens: req.maxTokens,
    input_tokens: totalInputTokens(msg.usage),
    output_tokens: msg.usage.output_tokens,
    cost_usd: costUsd(msg.model, msg.usage as Parameters<typeof costUsd>[1]),
  };
}

/**
 * Error SDK → kelas pipeline (docs/08 §5.4). Kunci salah/izin/model tidak dikenal adalah kesalahan
 * konfigurasi: sementara (capture tidak boleh gagal permanen karena kunci salah) + log ai.config_error.
 */
export function mapClaudeError(e: unknown, signal?: AbortSignal): Error {
  if (e instanceof PermanentError || e instanceof TransientError) return e;
  // APIUserAbortError dan APIConnectionError adalah subkelas APIError: dicek lebih dulu.
  if (e instanceof Anthropic.APIUserAbortError || signal?.aborted) {
    log('ai.deadline', { aborted: true });
    return new TransientError('ai: tenggat lease habis');
  }
  if (e instanceof Anthropic.APIConnectionError) return new TransientError('ai: koneksi/timeout');
  if (e instanceof Anthropic.RateLimitError) return new TransientError('ai: rate limit');
  if (e instanceof Anthropic.InternalServerError) return new TransientError(`ai: server ${e.status}`);
  if (e instanceof Anthropic.BadRequestError) {
    if (isImageError(e)) return new PermanentError('unsupported', 'Format gambar ini belum didukung.');
    log('ai.config_error', { status: 400, type: errorType(e) });
    return new TransientError('ai: permintaan ditolak (konfigurasi)');
  }
  if (e instanceof Anthropic.APIError) {
    if (e.status === 413) return new PermanentError('unsupported', 'Gambar terlalu besar untuk diproses.');
    if (typeof e.status === 'number' && e.status >= 500) return new TransientError(`ai: server ${e.status}`);
    log('ai.config_error', { status: e.status ?? null, type: errorType(e) });
    return new TransientError('ai: kesalahan konfigurasi');
  }
  return new TransientError('ai: kesalahan tak dikenal');
}

function errorType(e: InstanceType<typeof Anthropic.APIError>): string | null {
  const body = e.error as { error?: { type?: string } } | undefined;
  return body?.error?.type ?? null;
}

/** 400 karena isi gambar (bukan parameter). API tidak punya kode khusus, jadi dilihat dari pesannya. */
function isImageError(e: InstanceType<typeof Anthropic.BadRequestError>): boolean {
  const body = e.error as { error?: { message?: string } } | undefined;
  return /\bimage\b/i.test(body?.error?.message ?? e.message);
}
