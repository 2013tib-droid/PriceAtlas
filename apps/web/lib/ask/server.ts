// POST /api/ask (docs/08 §10.1, §10.4, §12.3). Logika dipisah dari Route Handler supaya bisa diuji
// tanpa Next.js (pola /api/account/delete). HANYA server: dipakai app/api/ask/route.ts (yang
// mengimpor 'server-only'); memuat SDK Anthropic lewat @priceatlas/ai-tools/ask.
//   1. Validasi zod (pertanyaan 1–200 karakter, history ≤ 4 pasangan teks)
//   2. User dari cookie sesi (JWT user; RLS berlaku untuk semua RPC di bawah)
//   3. Engine mati / kunci kosong → 503 AI_UNAVAILABLE (sebelum kuota, supaya tidak memakan kuota)
//   4. begin_ask() → kuota harian/bulanan/anggaran habis → 429 AI_QUOTA_EXCEEDED
//   5. runAsk (Claude ⇄ tool) atau runAskStub (ASK_ENGINE=stub, e2e/CI)
//   6. record_ask_usage(token, biaya), juga untuk percobaan yang gagal setelah memakai token
//   7. 200 { reply, tools_used }
// Log: hash id user, durasi, token, biaya, nama tool, kind. Teks pertanyaan/jawaban TIDAK dicatat.
import { createHash } from 'node:crypto';
import {
  AskRequestSchema,
  BeginAskResultSchema,
  parseRpcError,
  type AskErrorResponse,
  type AskResponse,
  type AskUnavailableReason,
  type RpcClient,
} from '@priceatlas/contracts';
import {
  ASK_MODEL,
  ASK_PROMPT_VERSION,
  AskError,
  createAskClaudeClient,
  runAsk,
  runAskStub,
  type AskClaudeClient,
  type AskErrorReason,
  type AskOutcome,
  type AskUsage,
} from '@priceatlas/ai-tools/ask';

export type AskEngine = { mode: 'claude'; apiKey: string; model: string } | { mode: 'stub' } | { mode: 'off' };

/**
 * ASK_ENGINE: `claude` (default, butuh ANTHROPIC_API_KEY), `stub` (e2e/CI, tanpa Claude), `off`.
 * ASK_MODEL (opsional): model lain hanya untuk membandingkan dengan set pertanyaan emas (Q-115).
 */
export function askEngineFromEnv(env: Record<string, string | undefined> = process.env): AskEngine {
  const mode = (env.ASK_ENGINE ?? 'claude').trim().toLowerCase();
  if (mode === 'stub') return { mode: 'stub' };
  if (mode !== 'claude') return { mode: 'off' };
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { mode: 'off' };
  return { mode: 'claude', apiKey, model: env.ASK_MODEL?.trim() || ASK_MODEL };
}

export type AskLogFn = (event: string, fields: Record<string, unknown>) => void;

export interface AskRouteDeps {
  getUser(): Promise<{ id: string } | null>;
  /** supabase-js dengan cookie sesi user (JWT user). */
  rpc: RpcClient;
  engine: AskEngine;
  /** Test: klien Claude palsu. Default: SDK dengan ANTHROPIC_API_KEY dari engine. */
  claude?: AskClaudeClient;
  signal?: AbortSignal;
  log?: AskLogFn;
  now?: () => number;
}

export type AskRouteResult =
  { status: 200; body: AskResponse } | { status: 400 | 401 | 429 | 503; body: AskErrorResponse };

const MESSAGES = {
  INVALID_INPUT: 'Pertanyaan tidak valid (1–200 karakter).',
  UNAUTHENTICATED: 'Masuk dulu untuk memakai Tanya.',
  AI_QUOTA_EXCEEDED: 'Batas pertanyaan Tanya sudah tercapai.',
  AI_UNAVAILABLE: 'Tanya sedang tidak tersedia.',
} as const;

export function jsonLog(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

/** Id user di log disamarkan (§10.4). */
export function userHash(id: string): string {
  return createHash('sha256').update(`priceatlas-ask:${id}`).digest('hex').slice(0, 12);
}

function unavailableReason(r: AskErrorReason): AskUnavailableReason {
  return r === 'config' || r === 'timeout' ? r : 'upstream';
}

export async function handleAsk(deps: AskRouteDeps, body: unknown): Promise<AskRouteResult> {
  const log = deps.log ?? jsonLog;
  const now = deps.now ?? Date.now;
  const t0 = now();
  const fail = (status: 400 | 401 | 429 | 503, error: AskErrorResponse['error'], reason?: string): AskRouteResult => ({
    status,
    body: { error, reason: reason ?? null, message: MESSAGES[error] },
  });

  const req = AskRequestSchema.safeParse(body);
  if (!req.success) return fail(400, 'INVALID_INPUT');
  const user = await deps.getUser();
  if (!user) return fail(401, 'UNAUTHENTICATED');
  const uid = userHash(user.id);
  if (deps.engine.mode === 'off') {
    log('ask.unavailable', { user: uid, reason: 'disabled' });
    return fail(503, 'AI_UNAVAILABLE', 'disabled');
  }

  const begin = await deps.rpc.rpc('begin_ask', {});
  if (begin.error) {
    const e = parseRpcError(begin.error);
    if (e.code === 'AI_QUOTA_EXCEEDED') {
      const reason = typeof e.detail.reason === 'string' ? e.detail.reason : null;
      log('ask.quota_exceeded', { user: uid, reason });
      return fail(429, 'AI_QUOTA_EXCEEDED', reason ?? undefined);
    }
    log('ask.begin_failed', { user: uid, code: e.code ?? e.sqlstate });
    return fail(503, 'AI_UNAVAILABLE', 'upstream');
  }
  const started = BeginAskResultSchema.safeParse(begin.data);
  if (!started.success) {
    log('ask.begin_failed', { user: uid, code: 'INVALID_RESULT' });
    return fail(503, 'AI_UNAVAILABLE', 'upstream');
  }
  const day = started.data.day;

  const record = async (usage: AskUsage) => {
    const { error } = await deps.rpc.rpc('record_ask_usage', {
      p_day: day,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cost_usd: usage.costUsd,
    });
    if (error) log('ask.usage_record_failed', { user: uid, code: parseRpcError(error).code });
  };

  const engine = deps.engine;
  let outcome: AskOutcome;
  try {
    outcome =
      engine.mode === 'stub'
        ? await runAskStub({ rpc: deps.rpc, question: req.data.question })
        : await runAsk({
            claude: deps.claude ?? createAskClaudeClient(engine.apiKey),
            model: engine.model,
            rpc: deps.rpc,
            question: req.data.question,
            history: req.data.history,
            today: day,
            signal: deps.signal,
            log: (event, fields) => log(event, { user: uid, ...fields }),
          });
  } catch (e) {
    const reason: AskErrorReason = e instanceof AskError ? e.reason : 'upstream';
    if (e instanceof AskError) await record(e.usage);
    else log('ask.crashed', { user: uid, error: e instanceof Error ? e.name : 'unknown' });
    log('ask.failed', {
      user: uid,
      reason,
      ms: now() - t0,
      ...(e instanceof AskError
        ? {
            input_tokens: e.usage.inputTokens,
            output_tokens: e.usage.outputTokens,
            cost_usd: e.usage.costUsd,
            tools: e.calls.map((c) => c.name),
          }
        : {}),
    });
    return fail(503, 'AI_UNAVAILABLE', unavailableReason(reason));
  }

  await record(outcome.usage);
  log('ask.done', {
    user: uid,
    engine: engine.mode,
    prompt_version: ASK_PROMPT_VERSION,
    ms: now() - t0,
    kind: outcome.reply.kind,
    final_kind: outcome.finalKind,
    tools: outcome.calls.map((c) => (c.ok ? c.name : `${c.name}!`)),
    rounds: outcome.rounds,
    requests: outcome.requests,
    input_tokens: outcome.usage.inputTokens,
    output_tokens: outcome.usage.outputTokens,
    cost_usd: outcome.usage.costUsd,
    served_model: outcome.servedModel,
    fallback_used: outcome.fallbackUsed,
    unsupported_numbers: outcome.unsupportedNumbers,
  });
  return { status: 200, body: { reply: outcome.reply, tools_used: outcome.toolsUsed } };
}
