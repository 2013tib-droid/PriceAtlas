// Loop Tanya (S-20, D-57; docs/08 §10). HANYA untuk server: dipakai route apps/web/app/api/ask
// (yang mengimpor 'server-only') dan skrip uji live. Tidak diekspor dari index paket, supaya kode
// klien yang memakai @priceatlas/ai-tools tidak ikut memuat SDK Anthropic.
//   * Loop tool manual: Claude ⇄ runTool(rpc dengan JWT user). Maks 4 putaran tool; putaran
//     berikutnya `tool_choice: none` sehingga model wajib menjawab. Error tool dikirim balik sebagai
//     tool_result `is_error: true` (data, bukan exception).
//   * Jawaban akhir lewat structured outputs (`output_config.format`, AskFinal), dipetakan ke
//     AskReply (§10.3). `tool`, `screen`, `basis` hanya dari output tool (F-122, §10.4).
//   * claude-opus-5-5 effort low, thinking adaptive, server-side fallback `fallbacks: 'default'`
//     untuk refusal. Konten asisten diteruskan apa adanya (append-only), kecuali blok model-internal
//     sebelum blok `fallback` terakhir (aturan echo fallback).
//   * Tenggat total 45 dtk (AbortSignal) di atas timeout klien 45 dtk, maxRetries 1.
//   * Cek angka rupiah di teks vs output tool: hanya dicatat (`ask.unsupported_number`), §10.4.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import {
  ASK_MAX_LENGTH,
  ASK_OPTIONS_MAX,
  ASK_TEXT_MAX,
  ASK_TOOLS,
  AskScreenRefSchema,
  type AskBasis,
  type AskHistoryTurn,
  type AskReply,
  type AskScreenRef,
  type AskTool,
  type AskToolRef,
  type RpcClient,
} from '@priceatlas/contracts';
import { registry, runTool, type ToolResult } from './index.ts';
import { costUsd, totalInputTokens, type UsageWithIterations } from './pricing.ts';
import { ASK_PROMPT_VERSION, ASK_SYSTEM_PROMPT_V1 } from './prompts/ask.v1.ts';

export { ASK_PROMPT_VERSION };
export const ASK_MODEL = 'claude-opus-5-5';
export const ASK_EFFORT = 'low';
export const ASK_MAX_TOOL_ROUNDS = 4;
export const ASK_MAX_TOKENS = 4000;
export const ASK_TIMEOUT_MS = 45_000;
export const ASK_MAX_RETRIES = 1;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Teks `not_enough` jika tidak ada output tool yang mendukung jawaban (teks model tidak dipakai). */
export const ASK_NO_DATA_TEXT = 'Belum ada data di historimu untuk menjawab pertanyaan ini.';

/** Jawaban akhir model (§10.2). Tanpa batasan panjang di skema (tidak didukung); dipotong saat pemetaan. */
export const AskFinalSchema = z.object({
  kind: z.enum(['answer', 'not_enough', 'ambiguous', 'out_of_scope']),
  text: z.string(),
  options: z.array(z.object({ label: z.string(), question: z.string() })),
});
export type AskFinal = z.infer<typeof AskFinalSchema>;

/** Bagian klien Anthropic yang dipakai; test memakai klien palsu dengan bentuk yang sama. */
export interface AskClaudeClient {
  beta: {
    messages: {
      create(params: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal | null }): PromiseLike<BetaMessage>;
    };
  };
}

export function createAskClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: ASK_TIMEOUT_MS, maxRetries: ASK_MAX_RETRIES });
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  ok: boolean;
  output?: unknown;
  error?: { kode: string; pesan: string };
}

export interface AskUsage {
  inputTokens: number;
  outputTokens: number;
  /** null jika ada respons dari model yang tidak ada di tabel harga. */
  costUsd: number | null;
}

export interface AskOutcome {
  reply: AskReply;
  toolsUsed: AskTool[];
  calls: ToolCallRecord[];
  usage: AskUsage;
  /** Putaran tool (respons `tool_use`). */
  rounds: number;
  /** Jumlah panggilan API. */
  requests: number;
  servedModel: string | null;
  fallbackUsed: boolean;
  /** kind dari model, atau 'refusal' (stop_reason refusal setelah fallback). */
  finalKind: AskFinal['kind'] | 'refusal';
  /** Angka rupiah di teks jawaban yang tidak ditemukan di output tool (§10.4, log saja). */
  unsupportedNumbers: number;
}

export type AskErrorReason = 'config' | 'timeout' | 'upstream' | 'invalid_output' | 'max_tokens' | 'tool_loop';

/** Gagal menjawab. Membawa pemakaian token sejauh ini supaya biayanya tetap dicatat (pola F-127). */
export class AskError extends Error {
  constructor(
    readonly reason: AskErrorReason,
    message: string,
    readonly usage: AskUsage,
    readonly calls: ToolCallRecord[] = [],
  ) {
    super(message);
    this.name = 'AskError';
  }
}

export type AskLog = (event: string, fields: Record<string, unknown>) => void;

export interface RunAskOptions {
  claude: AskClaudeClient;
  /** Klien RPC dengan JWT user (RLS berlaku). */
  rpc: RpcClient;
  question: string;
  history?: AskHistoryTurn[];
  /** Tanggal hari ini (YYYY-MM-DD, zona household) untuk konteks "kemarin", "minggu ini". */
  today: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  timeoutMs?: number;
  log?: AskLog;
}

// ---------------------------------------------------------------------------
// Permintaan
// ---------------------------------------------------------------------------

/** 6 tool registry (§10.2), tanpa `strict` (skema memakai batasan yang tidak didukung; zod di runTool). */
export const ASK_TOOL_DEFS: BetaTool[] = registry.map((t) => {
  const { $schema: _drop, ...schema } = t.inputSchema;
  return { name: t.name, description: t.description, input_schema: schema as BetaTool['input_schema'] };
});

export function supportsServerFallback(model: string): boolean {
  return !model.startsWith('claude-haiku');
}

export function buildAskParams(opts: {
  model: string;
  effort: 'low' | 'medium' | 'high';
  messages: BetaMessageParam[];
  forceFinal: boolean;
}): MessageCreateParamsNonStreaming {
  const params: MessageCreateParamsNonStreaming = {
    model: opts.model,
    max_tokens: ASK_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort, format: betaZodOutputFormat(AskFinalSchema) },
    system: [{ type: 'text', text: ASK_SYSTEM_PROMPT_V1, cache_control: { type: 'ephemeral' } }],
    tools: ASK_TOOL_DEFS,
    messages: opts.messages,
  };
  // tool_choice any/tool ditolak Opus 5.5; `none` diizinkan dan memaksa jawaban akhir.
  if (opts.forceFinal) params.tool_choice = { type: 'none' };
  if (supportsServerFallback(opts.model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

export function initialMessages(question: string, history: AskHistoryTurn[], today: string): BetaMessageParam[] {
  const msgs: BetaMessageParam[] = [];
  for (const h of history) {
    msgs.push({ role: 'user', content: h.question });
    msgs.push({ role: 'assistant', content: h.answer.trim() || '(tidak ada jawaban teks)' });
  }
  msgs.push({ role: 'user', content: `Hari ini: ${today} (zona Asia/Jakarta).\n\nPertanyaan: ${question}` });
  return msgs;
}

/**
 * Konten asisten untuk diteruskan ke permintaan berikutnya. Setelah fallback di tengah output,
 * blok model-internal (thinking, tool_use, server_tool_use) SEBELUM blok `fallback` terakhir dibuang;
 * sisanya diteruskan tanpa diubah (riwayat append-only, preserved thinking).
 */
export function echoContent(content: BetaContentBlock[]): BetaContentBlock[] {
  let lastFallback = -1;
  content.forEach((b, i) => {
    if (b.type === 'fallback') lastFallback = i;
  });
  if (lastFallback < 0) return content;
  const internal = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use']);
  return content.filter((b, i) => i > lastFallback || !internal.has(b.type));
}

// ---------------------------------------------------------------------------
// Pemetaan ke AskReply (§10.3)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isAskTool = (n: string): n is AskTool => (ASK_TOOLS as readonly string[]).includes(n);

function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Peta id → nama dari semua output tool (produk: nama + ukuran; group: nama). */
function namesFrom(calls: ToolCallRecord[]): Map<string, string> {
  const names = new Map<string, string>();
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!isObj(x)) return;
    if (typeof x.id === 'string' && typeof x.nama === 'string' && !names.has(x.id)) {
      names.set(x.id, typeof x.ukuran === 'string' ? `${x.nama} ${x.ukuran}` : x.nama);
    }
    Object.values(x).forEach(walk);
  };
  calls.filter((c) => c.ok).forEach((c) => walk(c.output));
  return names;
}

/** "Dijawab dengan: tool(arg)": arg = kata kunci, atau nama produk/group dari output tool. */
export function toolRefOf(call: ToolCallRecord, calls: ToolCallRecord[]): AskToolRef | null {
  if (!isAskTool(call.name)) return null;
  const input = isObj(call.input) ? call.input : {};
  const names = namesFrom(calls);
  const id = [input.produk_id, input.product_group_id].find((x): x is string => typeof x === 'string');
  const arg = typeof input.kata_kunci === 'string' ? input.kata_kunci : id ? (names.get(id) ?? null) : null;
  return { name: call.name, arg: arg == null ? null : clip(arg, 80) };
}

/** `layar` dari output tool. Hasil cari > 1 produk → S-02 dengan kata kunci tool. */
export function screenOf(call: ToolCallRecord): AskScreenRef | null {
  let out = call.output;
  if (Array.isArray(out)) {
    if (out.length === 1) out = out[0];
    else {
      const kw = isObj(call.input) ? call.input.kata_kunci : null;
      return typeof kw === 'string' && out.length > 1 ? { id: 'S-02', kata_kunci: kw } : null;
    }
  }
  if (!isObj(out)) return null;
  const parsed = AskScreenRefSchema.safeParse(out.layar);
  return parsed.success ? parsed.data : null;
}

/** `jumlah_data` + `tanggal_terakhir` dari output tool (array → jumlah dan tanggal terbaru). */
export function basisOf(call: ToolCallRecord): AskBasis {
  const items = Array.isArray(call.output) ? call.output : [call.output];
  let n = 0;
  let last: string | null = null;
  for (const it of items) {
    if (!isObj(it)) continue;
    if (typeof it.jumlah_data === 'number' && Number.isFinite(it.jumlah_data)) n += Math.max(0, Math.trunc(it.jumlah_data));
    const d = it.tanggal_terakhir;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && (last == null || d > last)) last = d;
  }
  return { jumlah_data: n, tanggal_terakhir: last };
}

/** AskFinal (atau hasil stub) → AskReply. Tidak ada field tautan/basis yang diambil dari teks model. */
export function mapFinal(final: AskFinal, calls: ToolCallRecord[]): AskReply {
  const last = calls.filter((c) => c.ok && isAskTool(c.name)).at(-1);
  const noData = (): AskReply => ({
    kind: 'not_enough',
    text: ASK_NO_DATA_TEXT,
    tool: last ? toolRefOf(last, calls) : null,
    screen: last ? screenOf(last) : null,
  });
  switch (final.kind) {
    case 'out_of_scope':
      return { kind: 'out_of_scope' };
    case 'ambiguous': {
      const options = final.options
        .map((o) => ({ label: clip(o.label, 80), question: clip(o.question, ASK_MAX_LENGTH) }))
        .filter((o) => o.label && o.question)
        .slice(0, ASK_OPTIONS_MAX);
      return options.length ? { kind: 'ambiguous', options } : noData();
    }
    case 'not_enough': {
      // Tanpa tool berhasil, teks model bisa berasal dari pengetahuan umum: pakai teks tetap.
      const text = last ? clip(final.text, ASK_TEXT_MAX) : '';
      return text ? { kind: 'not_enough', text, tool: toolRefOf(last!, calls), screen: screenOf(last!) } : noData();
    }
    case 'answer': {
      if (!last) return noData(); // §10.3: answer tanpa tool berhasil → not_enough
      const basis = basisOf(last);
      const text = clip(final.text, ASK_TEXT_MAX);
      const tool = toolRefOf(last, calls);
      if (!text || !tool || basis.jumlah_data === 0) return noData();
      return { kind: 'answer', text, basis, tool, screen: screenOf(last) };
    }
  }
}

const PRICE_KEY = /harga|satuan|rata2|termurah|per_isi/;

/** Angka rupiah di teks ("Rp18.000", "Rp90,5/g") yang tidak ada di output tool. */
export function unsupportedRupiah(text: string, calls: ToolCallRecord[]): number[] {
  // Hanya angka di kunci harga (bukan jumlah data, peringkat, persen): "Rp1" tidak didukung oleh jumlah_data 1.
  const known: number[] = [];
  const walk = (x: unknown, priceKey: boolean) => {
    if (typeof x === 'number' && Number.isFinite(x)) {
      if (priceKey) known.push(x);
    } else if (Array.isArray(x)) x.forEach((v) => walk(v, priceKey));
    else if (isObj(x)) for (const [k, v] of Object.entries(x)) walk(v, priceKey || PRICE_KEY.test(k));
  };
  calls.filter((c) => c.ok).forEach((c) => walk(c.output, false));
  const found: number[] = [];
  for (const m of text.matchAll(/Rp\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/gi)) {
    const v = Number(`${m[1]!.replace(/\./g, '')}${m[2] ? `.${m[2]}` : ''}`);
    const ok = known.some((k) => Math.abs(k - v) < 0.01 || Math.round(k) === v || Math.round(k * 10) / 10 === v);
    if (!ok) found.push(v);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function addUsage(acc: AskUsage, msg: BetaMessage): void {
  acc.inputTokens += totalInputTokens(msg.usage);
  acc.outputTokens += msg.usage.output_tokens;
  const c = costUsd(msg.model, msg.usage as UsageWithIterations);
  acc.costUsd = acc.costUsd == null || c == null ? null : Math.round((acc.costUsd + c) * 1e6) / 1e6;
}

function fellBack(msg: BetaMessage): boolean {
  return msg.content.some((b) => b.type === 'fallback') || (msg.usage.iterations ?? []).some((i) => i.type === 'fallback_message');
}

/** Error SDK → alasan (route: config/timeout/upstream → 503 AI_UNAVAILABLE dengan reason). */
export function askErrorReason(e: unknown, signal?: AbortSignal): AskErrorReason {
  if (e instanceof AskError) return e.reason;
  // APIUserAbortError dan APIConnectionError adalah subkelas APIError: dicek lebih dulu.
  if (e instanceof Anthropic.APIUserAbortError || signal?.aborted) return 'timeout';
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (e instanceof Anthropic.APIConnectionError) return 'upstream';
  if (e instanceof Anthropic.RateLimitError) return 'upstream';
  if (e instanceof Anthropic.InternalServerError) return 'upstream';
  if (
    e instanceof Anthropic.AuthenticationError ||
    e instanceof Anthropic.PermissionDeniedError ||
    e instanceof Anthropic.NotFoundError ||
    e instanceof Anthropic.BadRequestError
  ) {
    return 'config';
  }
  if (e instanceof Anthropic.APIError) return typeof e.status === 'number' && e.status >= 500 ? 'upstream' : 'config';
  return 'upstream';
}

async function execTool(rpc: RpcClient, block: BetaToolUseBlock, log: AskLog): Promise<[ToolCallRecord, BetaToolResultBlockParam]> {
  let r: ToolResult;
  try {
    r = await runTool(rpc, block.name, block.input);
  } catch {
    // Bukan error input/RPC yang dikenal (mis. keluaran RPC tidak lolos skema): tetap data untuk model.
    log('ask.tool_failed', { tool: block.name });
    r = { ok: false, error: { kode: 'TOOL_FAILED', pesan: 'Tool gagal dijalankan.' } };
  }
  const record: ToolCallRecord = r.ok
    ? { name: block.name, input: block.input, ok: true, output: r.output }
    : { name: block.name, input: block.input, ok: false, error: r.error };
  const result: BetaToolResultBlockParam = r.ok
    ? { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(r.output) }
    : { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: r.error }), is_error: true };
  return [record, result];
}

export async function runAsk(opts: RunAskOptions): Promise<AskOutcome> {
  const log = opts.log ?? (() => undefined);
  const model = opts.model ?? ASK_MODEL;
  const effort = opts.effort ?? ASK_EFFORT;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? ASK_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
  const usage: AskUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const calls: ToolCallRecord[] = [];
  const messages = initialMessages(opts.question, opts.history ?? [], opts.today);
  let rounds = 0;
  let requests = 0;
  let servedModel: string | null = null;
  let fallbackUsed = false;
  const fail = (reason: AskErrorReason, message: string) => new AskError(reason, message, usage, calls);

  for (;;) {
    if (signal.aborted) throw fail('timeout', 'Tenggat Tanya habis');
    const forceFinal = rounds >= ASK_MAX_TOOL_ROUNDS;
    let msg: BetaMessage;
    try {
      msg = await opts.claude.beta.messages.create(buildAskParams({ model, effort, messages, forceFinal }), { signal });
    } catch (e) {
      const reason = askErrorReason(e, signal);
      if (reason === 'config') log('ask.config_error', { status: e instanceof Anthropic.APIError ? (e.status ?? null) : null });
      throw fail(reason, e instanceof Error ? e.message : 'Gagal memanggil Claude');
    }
    requests++;
    addUsage(usage, msg);
    servedModel = msg.model;
    fallbackUsed ||= fellBack(msg);
    const base = { toolsUsed: toolsUsedOf(calls), calls, usage, rounds, requests, servedModel, fallbackUsed };

    if (msg.stop_reason === 'refusal') {
      log('ask.refusal', { model: msg.model, category: msg.stop_details?.category ?? null });
      return { ...base, reply: { kind: 'out_of_scope' }, finalKind: 'refusal', unsupportedNumbers: 0 };
    }
    if (msg.stop_reason === 'max_tokens') throw fail('max_tokens', 'Jawaban terpotong (max_tokens)');

    if (msg.stop_reason === 'tool_use') {
      const content = echoContent(msg.content);
      const uses = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
      if (forceFinal || uses.length === 0) throw fail('tool_loop', 'Model tetap memanggil tool setelah batas');
      rounds++;
      const done = await Promise.all(uses.map((u) => execTool(opts.rpc, u, log)));
      for (const [record] of done) calls.push(record);
      const results: (BetaToolResultBlockParam | BetaTextBlockParam)[] = done.map(([, r]) => r);
      if (rounds >= ASK_MAX_TOOL_ROUNDS) {
        results.push({ type: 'text', text: 'Batas pemanggilan tool tercapai. Jawab sekarang hanya dari output tool yang ada.' });
      }
      messages.push({ role: 'assistant', content: content as BetaContentBlockParam[] });
      messages.push({ role: 'user', content: results });
      continue;
    }

    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let final: AskFinal;
    try {
      final = AskFinalSchema.parse(JSON.parse(text));
    } catch {
      log('ask.invalid_output', { model: msg.model, stop_reason: msg.stop_reason });
      throw fail('invalid_output', 'Jawaban akhir tidak sesuai skema');
    }
    const reply = mapFinal(final, calls);
    const unsupported = reply.kind === 'answer' || reply.kind === 'not_enough' ? unsupportedRupiah(reply.text, calls) : [];
    if (unsupported.length) log('ask.unsupported_number', { count: unsupported.length, kind: reply.kind });
    return { ...base, toolsUsed: toolsUsedOf(calls), reply, finalKind: final.kind, unsupportedNumbers: unsupported.length };
  }
}

function toolsUsedOf(calls: ToolCallRecord[]): AskTool[] {
  return [...new Set(calls.map((c) => c.name).filter(isAskTool))];
}

// ---------------------------------------------------------------------------
// ASK_ENGINE=stub (e2e/CI, docs/08 §13.1): tanpa Claude. Pola pertanyaan → tool sungguhan dengan JWT
// user → AskFinal tiruan → pemetaan yang sama dengan runAsk. Deterministik.
// ---------------------------------------------------------------------------

const OUT_OF_SCOPE = /\b(total|pengeluaran|budget|anggaran|resep|pasar|simpan|catat|hapus|ubah)\b/i;
const STOP_WORDS = new Set(
  (
    'termurah paling murah mahal di mana dimana harga berapa naik turun atau per gram ml pcs satuan yang apa ' +
    'beli lebih hemat tren sekarang ini itu kah ya dong sih tolong cek'
  ).split(' '),
);

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

export async function runAskStub(opts: { rpc: RpcClient; question: string }): Promise<AskOutcome> {
  const calls: ToolCallRecord[] = [];
  const call = async (name: string, input: Obj) => {
    const r = await runTool(opts.rpc, name, input);
    const rec: ToolCallRecord = r.ok ? { name, input, ok: true, output: r.output } : { name, input, ok: false, error: r.error };
    calls.push(rec);
    return rec;
  };
  const q = opts.question.toLowerCase();
  const finish = (final: AskFinal): AskOutcome => ({
    reply: mapFinal(final, calls),
    toolsUsed: toolsUsedOf(calls),
    calls,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    rounds: calls.length,
    requests: 0,
    servedModel: 'stub',
    fallbackUsed: false,
    finalKind: final.kind,
    unsupportedNumbers: 0,
  });
  const notEnough = (text: string): AskOutcome => finish({ kind: 'not_enough', text, options: [] });

  if (OUT_OF_SCOPE.test(q)) return finish({ kind: 'out_of_scope', text: '', options: [] });
  const kw = q
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(' ')
    .slice(0, 100);
  if (kw.length < 2) return notEnough('Sebutkan nama produknya, mis. "milo termurah di mana?".');

  const found = await call('cari_harga_terbaik', { kata_kunci: kw });
  const items = found.ok && Array.isArray(found.output) ? (found.output as Obj[]) : [];
  if (items.length === 0) return notEnough(`Belum ada data "${kw}" di historimu.`);
  // Nama + ukuran disebut lengkap di pertanyaan → produk itu (bukan ambigu).
  const exact = items.filter((it) => {
    const p = it.produk as Obj;
    return q.includes(`${String(p.nama)} ${String(p.ukuran)}`.toLowerCase());
  });
  const item = items.length === 1 ? items[0]! : exact.length === 1 ? exact[0]! : null;
  if (!item) {
    const intent = q.match(/(termurah di mana|naik atau turun|per gram|per satuan)/)?.[1] ?? 'termurah di mana';
    return finish({
      kind: 'ambiguous',
      text: '',
      options: items.slice(0, ASK_OPTIONS_MAX).map((it) => {
        const p = it.produk as Obj;
        const label = `${String(p.nama)} ${String(p.ukuran)}`;
        return { label, question: `${label} ${intent}?` };
      }),
    });
  }
  const pid = (item.produk as Obj).id as string;
  // Dipilih dari beberapa hasil: panggil ulang per produk supaya layar/basis milik produk itu saja.
  if (items.length > 1) await call('cari_harga_terbaik', { produk_id: pid });

  if (/per (gram|ml|satuan|pcs)/.test(q)) {
    const r = await call('harga_per_satuan', { produk_id: pid });
    const o = (r.output ?? {}) as Obj;
    if (!r.ok || o.terbaik_90_hari_per_satuan == null) return notEnough('Belum ada harga 90 hari terakhir untuk dihitung per satuan.');
    return finish({
      kind: 'answer',
      text: `Harga terbaik 90 hari: Rp${String(o.terbaik_90_hari_per_satuan).replace('.', ',')}/${String(o.satuan_dasar)}.`,
      options: [],
    });
  }
  if (/(naik|turun|tren)/.test(q)) {
    const r = await call('tren_harga', { produk_id: pid });
    const o = (r.output ?? {}) as Obj;
    if (!r.ok || o.arah == null) return notEnough(`Baru ada ${String(o.jumlah_data ?? 0)} data. Belum cukup untuk melihat tren.`);
    return finish({ kind: 'answer', text: `Harga ${String(o.arah)} ${String(o.persen ?? 0)}% dibanding 30 hari sebelumnya.`, options: [] });
  }
  const best = item.terbaik_90_hari as Obj | null;
  if (!best) return notEnough('Belum ada harga 90 hari terakhir untuk produk ini.');
  return finish({
    kind: 'answer',
    text: `Termurah 90 hari terakhir: ${rupiah(Number(best.harga))} (${String(best.label)}) di ${String(best.toko)}, ${String(best.cabang)}.`,
    options: [],
  });
}
