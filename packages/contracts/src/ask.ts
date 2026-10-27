// Tanya (S-20, D-57; docs/08 §10, §11.3): kontrak POST /api/ask dan bentuk balasan.
// Dipakai route server (apps/web/app/api/ask), loop packages/ai-tools/src/ask.ts, dan layar S-20.
// Bentuk `layar` sama dengan keluaran tool packages/ai-tools (S-03b ditambah, F-113).
import { z } from 'zod';

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Panjang pertanyaan (docs/08 §10.1 langkah 1). */
export const ASK_MAX_LENGTH = 200;
/** Pasangan tanya-jawab sebelumnya yang ikut dikirim (teks saja, tanpa output tool, §10.4). */
export const ASK_HISTORY_MAX = 4;
/** Panjang teks jawaban (AskFinal.text, §10.2). */
export const ASK_TEXT_MAX = 400;
/** Pilihan produk ambigu (§10.2). */
export const ASK_OPTIONS_MAX = 4;

/** Nama tool packages/ai-tools (test di ai-tools memastikan sama dengan registry). */
export const ASK_TOOLS = [
  'cari_harga_terbaik',
  'tren_harga',
  'harga_per_satuan',
  'bandingkan_ukuran',
  'lebih_hemat_di_mana',
  'histori_harga',
] as const;
export type AskTool = (typeof ASK_TOOLS)[number];

/** Rujukan layar sumber = bentuk `layar` di keluaran tool (U-18). */
export const AskScreenRefSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('S-02'), kata_kunci: z.string() }),
  z.object({ id: z.literal('S-03'), produk_id: Uuid }),
  z.object({ id: z.literal('S-03b'), produk_id: Uuid }),
  z.object({ id: z.literal('S-04'), product_group_id: Uuid }),
  z.object({ id: z.literal('S-05'), produk_id: Uuid.nullish(), product_group_id: Uuid.nullish() }),
]);
export type AskScreenRef = z.infer<typeof AskScreenRefSchema>;

/** "Dijawab dengan: tool(arg)". `arg` ringkas (nama produk / kata kunci), bukan JSON argumen. */
export const AskToolRefSchema = z.object({ name: z.enum(ASK_TOOLS), arg: z.string().nullish() });
export type AskToolRef = z.infer<typeof AskToolRefSchema>;

/** Dasar jawaban dari output tool (`jumlah_data`, `tanggal_terakhir`); UI memformat "N data, terakhir …". */
export const AskBasisSchema = z.object({ jumlah_data: z.number().int().nonnegative(), tanggal_terakhir: IsoDate.nullable() });
export type AskBasis = z.infer<typeof AskBasisSchema>;

export const AskOptionSchema = z.object({ label: z.string().min(1), question: z.string().min(1).max(ASK_MAX_LENGTH) });

/**
 * Balasan server (§10.3). `tool`/`screen`/`basis` selalu dari output tool, tidak pernah dari teks model.
 * `not_enough` tanpa tool berhasil → `tool` dan `screen` null.
 */
export const AskReplySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('answer'),
    text: z.string().min(1).max(ASK_TEXT_MAX),
    basis: AskBasisSchema,
    tool: AskToolRefSchema,
    screen: AskScreenRefSchema.nullable(),
  }),
  z.object({
    kind: z.literal('not_enough'),
    text: z.string().min(1).max(ASK_TEXT_MAX),
    tool: AskToolRefSchema.nullable(),
    screen: AskScreenRefSchema.nullable(),
  }),
  z.object({ kind: z.literal('ambiguous'), options: z.array(AskOptionSchema).min(1).max(ASK_OPTIONS_MAX) }),
  z.object({ kind: z.literal('out_of_scope') }),
]);
export type AskReply = z.infer<typeof AskReplySchema>;

export const AskHistoryTurnSchema = z.strictObject({
  question: z.string().trim().min(1).max(ASK_MAX_LENGTH),
  answer: z.string().max(ASK_TEXT_MAX),
});
export type AskHistoryTurn = z.infer<typeof AskHistoryTurnSchema>;

export const AskRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(ASK_MAX_LENGTH),
    history: z.array(AskHistoryTurnSchema).max(ASK_HISTORY_MAX).default([]),
  })
  .strict();
export type AskRequest = z.input<typeof AskRequestSchema>;

export const AskResponseSchema = z.object({ reply: AskReplySchema, tools_used: z.array(z.enum(ASK_TOOLS)) });
export type AskResponse = z.infer<typeof AskResponseSchema>;

/** Alasan 429 (begin_ask detail.reason) dan 503 (route). */
export const ASK_QUOTA_REASONS = ['daily', 'monthly', 'budget'] as const;
export const ASK_UNAVAILABLE_REASONS = ['disabled', 'config', 'timeout', 'upstream'] as const;
export type AskQuotaReason = (typeof ASK_QUOTA_REASONS)[number];
export type AskUnavailableReason = (typeof ASK_UNAVAILABLE_REASONS)[number];

/** Body error route: 400 INVALID_INPUT, 401 UNAUTHENTICATED, 429 AI_QUOTA_EXCEEDED, 503 AI_UNAVAILABLE. */
export const AskErrorResponseSchema = z.object({
  error: z.enum(['INVALID_INPUT', 'UNAUTHENTICATED', 'AI_QUOTA_EXCEEDED', 'AI_UNAVAILABLE']),
  reason: z.string().nullish(),
  message: z.string(),
});
export type AskErrorResponse = z.infer<typeof AskErrorResponseSchema>;

/** Keluaran public.begin_ask(). */
export const BeginAskResultSchema = z.object({
  day: IsoDate,
  questions_today: z.number().int(),
  daily_limit: z.number().int(),
  questions_month: z.number().int(),
  monthly_limit: z.number().int(),
});
export type BeginAskResult = z.infer<typeof BeginAskResultSchema>;

/** Input RPC route Tanya (RPC_NAMES.askRoute); test sql-equivalence memeriksa argumennya. */
export const ASK_RPC_INPUTS = {
  begin_ask: z.object({}),
  record_ask_usage: z.object({
    p_day: IsoDate,
    p_input_tokens: z.number().int().min(0),
    p_output_tokens: z.number().int().min(0),
    p_cost_usd: z.number().min(0).max(1).nullable().optional(),
  }),
} as const;
