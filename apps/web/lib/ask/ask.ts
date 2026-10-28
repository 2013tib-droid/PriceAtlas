// S-20 Tanya (docs/07 §9, docs/08 §10, wireframe S-20, D-57). Bentuk balasan server ada di kontrak
// (packages/contracts/src/ask.ts); di sini keadaan UI tambahan, tautan layar sumber, pengiriman ke
// POST /api/ask, dan riwayat di perangkat (💾, 20 tanya-jawab terakhir per user, §10.4).
import {
  ASK_HISTORY_MAX,
  ASK_TEXT_MAX,
  AskErrorResponseSchema,
  AskResponseSchema,
  type AskHistoryTurn,
  type AskQuotaReason,
  type AskReply as ServerReply,
  type AskScreenRef,
  type AskToolRef,
} from '@priceatlas/contracts';

export { ASK_MAX_LENGTH, ASK_TOOLS } from '@priceatlas/contracts';
export type { AskBasis, AskScreenRef, AskTool, AskToolRef } from '@priceatlas/contracts';

/**
 * Keadaan balasan di S-20: 4 bentuk dari server + memuat, "Segera hadir" (503 disabled/config),
 * kuota habis (429), gagal (timeout, jaringan, 5xx).
 */
export type AskReply =
  | ServerReply
  | { kind: 'loading' }
  | { kind: 'coming_soon' }
  | { kind: 'quota'; reason: AskQuotaReason | null }
  | { kind: 'failed' };

/** Satu giliran di riwayat perangkat. `loading` tidak pernah disimpan. */
export interface AskTurn {
  id: string;
  question: string;
  reply: Exclude<AskReply, { kind: 'loading' }>;
  at: number;
}

export const ASK_HISTORY_KEEP = 20;
/** S-03b: sheet "Cek harga rak" di S-03 (`features/product/product-screen.tsx` SHEET_SHELF). */
const SHEET_SHELF = 'cek-harga';

export function askHref(q?: string | null): string {
  const t = q?.trim();
  return t ? `/tanya?q=${encodeURIComponent(t)}` : '/tanya';
}

/** "bandingkan_ukuran(Milo Original)" (wireframe "Dijawab dengan: …"). */
export function toolLabel(tool: AskToolRef): string {
  return `${tool.name}(${tool.arg ?? ''})`;
}

/** Tautan ke layar sumber; null jika rujukan tidak lengkap. */
export function screenHref(ref: AskScreenRef): string | null {
  switch (ref.id) {
    case 'S-02':
      return ref.kata_kunci.trim() ? `/cari?q=${encodeURIComponent(ref.kata_kunci.trim())}` : null;
    case 'S-03':
      return `/produk?id=${encodeURIComponent(ref.produk_id)}`;
    case 'S-03b':
      return `/produk?id=${encodeURIComponent(ref.produk_id)}&sheet=${SHEET_SHELF}`;
    case 'S-04':
      return `/produk/ukuran?group=${encodeURIComponent(ref.product_group_id)}`;
    case 'S-05':
      if (ref.produk_id) return `/produk/hemat?id=${encodeURIComponent(ref.produk_id)}`;
      if (ref.product_group_id) return `/produk/hemat?group=${encodeURIComponent(ref.product_group_id)}`;
      return null;
  }
}

/** Contoh pertanyaan (chip) digabung dengan kata kunci cari: "milo" + "termurah di mana?". */
export function exampleQuestion(subject: string | null | undefined, example: string): string {
  const s = subject?.trim();
  return s ? `${s} ${example}` : example;
}

/** Teks jawaban untuk `history` permintaan berikutnya (teks saja, tanpa output tool, §10.4). */
export function replyText(reply: AskTurn['reply'], copy: { outOfScope: string; ambiguous: string }): string | null {
  switch (reply.kind) {
    case 'answer':
    case 'not_enough':
      return reply.text;
    case 'ambiguous':
      return `${copy.ambiguous} ${reply.options.map((o) => o.label).join('; ')}`.slice(0, ASK_TEXT_MAX);
    case 'out_of_scope':
      return copy.outOfScope.slice(0, ASK_TEXT_MAX);
    default:
      return null;
  }
}

/** Maks 4 pasangan terakhir yang benar-benar dijawab (gagal/kuota/segera hadir dilewati). */
export function historyForRequest(
  turns: readonly AskTurn[],
  copy: { outOfScope: string; ambiguous: string },
): AskHistoryTurn[] {
  const out: AskHistoryTurn[] = [];
  for (const t of turns) {
    const answer = replyText(t.reply, copy);
    if (answer != null) out.push({ question: t.question, answer });
  }
  return out.slice(-ASK_HISTORY_MAX);
}

/** Riwayat di perangkat: terbaru di akhir, maks 20 (§10.4). */
export function pushTurn(list: readonly AskTurn[], turn: AskTurn): AskTurn[] {
  return [...list.filter((t) => t.id !== turn.id), turn].slice(-ASK_HISTORY_KEEP);
}

/** POST /api/ask → keadaan balasan. Tidak pernah melempar. */
export async function postAsk(
  question: string,
  history: AskHistoryTurn[],
  fetchImpl: typeof fetch = fetch,
): Promise<Exclude<AskReply, { kind: 'loading' }>> {
  let res: Response;
  try {
    res = await fetchImpl('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ question, history }),
    });
  } catch {
    return { kind: 'failed' };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const ok = AskResponseSchema.safeParse(json);
    return ok.success ? ok.data.reply : { kind: 'failed' };
  }
  const err = AskErrorResponseSchema.safeParse(json);
  const reason = err.success ? (err.data.reason ?? null) : null;
  if (res.status === 429) {
    return { kind: 'quota', reason: reason === 'daily' || reason === 'monthly' || reason === 'budget' ? reason : null };
  }
  if (res.status === 503 && (reason === 'disabled' || reason === 'config')) return { kind: 'coming_soon' };
  return { kind: 'failed' };
}
