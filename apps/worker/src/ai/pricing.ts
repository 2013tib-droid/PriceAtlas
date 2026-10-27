// Tabel harga per model (docs/08 §1.3, §12) → biaya per panggilan untuk processing_run.cost_usd.
// Sumber: skill claude-api (cache 2026-10-06). Diperiksa ulang di halaman pricing resmi sebelum
// anggaran diputuskan (M1); setiap perubahan = baris baru dengan tanggal `asOf` baru.
// Penulisan cache: 1,25× input (TTL 5 menit), 2× input (TTL 1 jam). Pembacaan cache sesuai tabel.

export const PRICING_AS_OF = '2026-10-06';

export interface ModelPrice {
  /** US$ per 1 juta token. */
  input: number;
  output: number;
  cacheRead: number;
  /** Prompt di atas batas ini memakai `long` (Haiku 5.5: > 100K token). */
  longContext?: { aboveInputTokens: number; input: number; output: number };
}

export const PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    // Harga cache read Haiku 5.5 tidak ada di cache skill; dianggap 0,1× input sampai dicek (§17).
    cacheRead: 0.01,
    longContext: { aboveInputTokens: 100_000, input: 0.5, output: 2.5 },
  },
  // Model cadangan server-side fallback (`fallbacks: 'default'`), ditagih dengan harganya sendiri.
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
}

/** Satu iterasi `usage.iterations` (respons dengan fallback memuat satu entri per model yang berjalan). */
export interface UsageIteration extends TokenUsage {
  type: string;
  model?: string | null;
}

export interface UsageWithIterations extends TokenUsage {
  iterations?: UsageIteration[] | null;
}

/** Model bertanggal/beralias dipetakan ke kunci tabel (mis. `claude-opus-5-5-…` → `claude-opus-5-5`). */
export function priceOf(model: string): ModelPrice | null {
  if (PRICES[model]) return PRICES[model]!;
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(`${k}-`) || model.startsWith(`${k}@`));
  return key ? PRICES[key]! : null;
}

/** Total token input yang diproses (tanpa cache + tulis cache + baca cache). */
export function totalInputTokens(u: TokenUsage): number {
  return u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}

function costOne(model: string, u: TokenUsage): number | null {
  const p = priceOf(model);
  if (!p) return null;
  const long = p.longContext && totalInputTokens(u) > p.longContext.aboveInputTokens ? p.longContext : null;
  const input = long?.input ?? p.input;
  const output = long?.output ?? p.output;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens : (u.cache_creation_input_tokens ?? 0);
  const usd =
    u.input_tokens * input +
    write5m * input * 1.25 +
    write1h * input * 2 +
    (u.cache_read_input_tokens ?? 0) * p.cacheRead +
    u.output_tokens * output;
  return usd / 1_000_000;
}

/**
 * Biaya US$ dari `usage` respons. Jika ada `iterations` (fallback), setiap iterasi dihitung dengan
 * harga modelnya sendiri. Model tak dikenal → `null` (biaya tidak dicatat, bukan nol palsu).
 */
export function costUsd(model: string, usage: UsageWithIterations): number | null {
  const its = usage.iterations?.filter((i) => typeof i.input_tokens === 'number' && typeof i.output_tokens === 'number') ?? [];
  if (its.length === 0) return round6(costOne(model, usage));
  let sum = 0;
  for (const it of its) {
    const c = costOne(it.model ?? model, it);
    if (c === null) return null;
    sum += c;
  }
  return round6(sum);
}

function round6(n: number | null): number | null {
  return n === null ? null : Math.round(n * 1e6) / 1e6;
}
