// ClaudeAiMatcher (docs/08 §7): matcher tier 4 untuk item TANPA kandidat tier 1–3 (D-75).
//   1. Daftar pendek per item dari database (app.ai_match_shortlist, §7.2): hanya produk active
//      global + privat household sendiri. Item tanpa daftar pendek tidak dikirim (tanpa biaya).
//   2. Satu panggilan Claude per capture untuk semua item (structured outputs, effort low).
//      Model melihat indeks lokal 1..m, bukan UUID, sehingga tidak bisa mengarang id.
//   3. Validasi: item dan pilihan harus ada di daftar pendek; confidence = min(model,
//      ai_match_max_confidence) < τ, jadi saran AI selalu dikonfirmasi user (D-12).
// Error apa pun tidak menggagalkan capture: item tetap tanpa saran (log ai.match_failed).
// Dipasang lewat `AI_MATCHER=claude` dengan model `EXTRACT_MODEL` (select.ts, 6b M2).
import { z } from 'zod';
import { callStructured, type ClaudeClient, type Effort } from '../ai/claude.ts';
import type { Db } from '../db.ts';
import { log } from '../log.ts';
import type { AiMatcher, MatchContext, MatchSuggestion, RunOutput, UnmatchedItem } from '../pipeline/types.ts';
import { MATCH_PROMPT_VERSION, matchPrompt } from './prompts/index.ts';

export const MATCH_MAX_TOKENS = 2_000;
export const SHORTLIST_LIMIT = 15;

/** Skema structured outputs (datar, tanpa min/max, F-108): batas diperiksa di sini. */
export const LlmMatchSchema = z.object({
  matches: z.array(
    z.object({
      item: z.number(),
      choice: z.number().nullable(),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});
export type LlmMatch = z.infer<typeof LlmMatchSchema>;

export interface ShortlistCandidate {
  product_id: string;
  brand: string | null;
  name: string;
  variant: string | null;
  size: string | null;
  sale_mode: 'unit' | 'weight';
  category: string | null;
  similarity: number;
}

export interface MatcherConfig {
  model: string;
  effort?: Effort;
  shortlistLimit?: number;
}

export class ClaudeAiMatcher implements AiMatcher {
  readonly promptVersion = MATCH_PROMPT_VERSION;

  constructor(
    private readonly db: Db,
    private readonly client: ClaudeClient,
    private readonly cfg: MatcherConfig,
  ) {}

  async match(items: UnmatchedItem[], ctx: MatchContext): Promise<MatchSuggestion[]> {
    if (items.length === 0) return [];
    try {
      const { lists, maxConfidence } = await this.shortlist(items, ctx);
      const sent = items.filter((it) => (lists.get(it.key)?.length ?? 0) > 0);
      if (sent.length === 0) return [];

      const res = await callStructured(this.client, {
        model: this.cfg.model,
        effort: this.cfg.effort ?? 'low',
        system: matchPrompt(this.promptVersion),
        content: [{ type: 'text', text: buildMatchMessage(sent, lists, ctx) }],
        schema: LlmMatchSchema,
        maxTokens: MATCH_MAX_TOKENS,
        attempt: 1,
        signal: ctx.signal,
      }).catch((e: unknown) => {
        // Respons sudah diterima (refusal, max_tokens, JSON tidak valid): biayanya tetap dihitung.
        const usage = (e as { runOutput?: RunOutput } | null)?.runOutput?.usage;
        if (usage) ctx.onUsage?.(usage);
        throw e;
      });
      ctx.onUsage?.(res.usage);

      const out = mapMatches(res.data, sent, lists, maxConfidence);
      log('ai.match', {
        model: res.meta.served_model,
        prompt_version: this.promptVersion,
        items: items.length,
        sent: sent.length,
        suggested: out.length,
        cost_usd: res.usage.costUsd,
      });
      return out;
    } catch (e) {
      log('ai.match_failed', { items: items.length, error: e instanceof Error ? e.name : 'unknown' });
      return [];
    }
  }

  /** Daftar pendek per key. Screenshot: nama produk dan judul listing digabung (Q-133). */
  private async shortlist(items: UnmatchedItem[], ctx: MatchContext) {
    const query: { key: number; raw_text: string }[] = [];
    for (const it of items) {
      query.push({ key: it.key, raw_text: it.raw_text });
      if (it.title && it.title !== it.raw_text) query.push({ key: -it.key, raw_text: it.title });
    }
    const limit = this.cfg.shortlistLimit ?? SHORTLIST_LIMIT;
    const r = await this.db.query<{ r: { key: number; candidates: ShortlistCandidate[] }[]; max: string | null }>(
      `select app.ai_match_shortlist($1, $2, $3, $4) as r, app.config_numeric('ai_match_max_confidence') as max`,
      [ctx.householdId, ctx.storeId, JSON.stringify(query), limit],
    );
    const lists = new Map<number, ShortlistCandidate[]>();
    for (const row of r.rows[0]?.r ?? []) {
      const key = Math.abs(row.key);
      const merged = [...(lists.get(key) ?? []), ...row.candidates];
      const seen = new Set<string>();
      lists.set(
        key,
        merged
          .sort((a, b) => b.similarity - a.similarity || a.product_id.localeCompare(b.product_id))
          .filter((c) => !seen.has(c.product_id) && (seen.add(c.product_id), true))
          .slice(0, limit),
      );
    }
    const max = Number(r.rows[0]?.max ?? 0.85);
    return { lists, maxConfidence: Number.isFinite(max) ? max : 0.85 };
  }
}

/** Pesan user: konteks toko lalu item bernomor 1..n dengan kandidat bernomor 1..m (tanpa UUID). */
export function buildMatchMessage(items: UnmatchedItem[], lists: Map<number, ShortlistCandidate[]>, ctx: MatchContext): string {
  return JSON.stringify({
    store: ctx.storeName ?? null,
    source: ctx.kind,
    items: items.map((it, i) => ({
      item: i + 1,
      text: it.raw_text,
      title: it.title ?? null,
      amount: it.amount ?? null,
      quantity: it.quantity ?? null,
      candidates: (lists.get(it.key) ?? []).map((c, j) => ({
        choice: j + 1,
        brand: c.brand,
        name: c.name,
        variant: c.variant,
        size: c.size,
        sale_mode: c.sale_mode,
        category: c.category,
      })),
    })),
  });
}

/** Indeks model → product_id. Item/pilihan di luar daftar pendek, duplikat, atau null dibuang. */
export function mapMatches(
  data: LlmMatch,
  sent: UnmatchedItem[],
  lists: Map<number, ShortlistCandidate[]>,
  maxConfidence: number,
): MatchSuggestion[] {
  const out = new Map<number, MatchSuggestion>();
  for (const m of data.matches) {
    if (!Number.isInteger(m.item) || m.choice === null || !Number.isInteger(m.choice)) continue;
    const it = sent[m.item - 1];
    if (!it || out.has(it.key)) continue;
    const cand = lists.get(it.key)?.[m.choice - 1];
    if (!cand) continue;
    const conf = Number.isFinite(m.confidence) ? Math.min(Math.max(m.confidence, 0), 1) : 0;
    out.set(it.key, { key: it.key, product_id: cand.product_id, confidence: round3(Math.min(conf, maxConfidence)) });
  }
  return [...out.values()];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
