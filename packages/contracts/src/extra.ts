import { z } from 'zod';

// Kontrak price_record.extra dan capture_item.extra (X-10, D-52, D-66; docs/05 §2.2).
// Padanan SQL: app.valid_price_extra(). Kunci yang tidak dikenal ditolak.
// Test test/sql-equivalence.test.ts membandingkan keduanya pada kasus yang sama.

const nonNegative = z.number().finite().min(0);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const MemberHintSchema = z.strictObject({
  program_id: uuid.optional(),
  text: z.string(),
});

export const PriceExtraSchema = z.strictObject({
  shipping_fee: nonNegative.optional(),
  shop_voucher: nonNegative.optional(),
  cashback: nonNegative.optional(),
  points: nonNegative.optional(),
  listing_title: z.string().max(500).optional(),
  listing_url: z.string().max(2000).startsWith('https://').optional(),
  member_note: z.string().max(200).optional(),
  member_eligible: z.boolean().optional(),
  member_hint: MemberHintSchema.optional(),
  note: z.string().max(500).optional(),
});

export type PriceExtra = z.infer<typeof PriceExtraSchema>;

/** Kunci yang hanya diisi sistem; RPC koreksi mempertahankan nilainya. */
export const SYSTEM_EXTRA_KEYS = ['member_eligible', 'member_hint'] as const;

export function isValidPriceExtra(x: unknown): x is PriceExtra {
  return PriceExtraSchema.safeParse(x).success;
}
