// Skema structured outputs khusus LLM (docs/08 §5.2, F-108). Terpisah dari kontrak `parsed`:
// datar, semua field wajib (nilai kosong = null), enum eksplisit, tanpa min/max/regex/default/union
// tingkat atas. Batasan angka dan aturan bisnis diperiksa konverter (convert.ts), lalu kontrak
// ParsedOutputSchema tetap jadi gerbang akhir di pipeline.
import { z } from 'zod';
import type { CaptureKind } from '@priceatlas/contracts';

const DocumentSchema = z.object({
  type: z.enum(['receipt', 'price_label', 'marketplace', 'other']),
  readable: z.boolean(),
  reason: z.string().nullable(),
});

const StoreSchema = z.object({
  name: z.string().nullable(),
  branch: z.string().nullable(),
  confidence: z.number(),
});

export const LLM_LINE_TYPES = ['product', 'discount', 'void', 'non_product', 'tax', 'other'] as const;
export const LLM_PAYMENT_METHODS = ['cash', 'debit', 'credit', 'qris', 'ewallet', 'other'] as const;

export const LlmReceiptLineSchema = z.object({
  /** Bagian ke- (1-based) untuk struk multi-gambar (F-120). */
  section: z.number(),
  type: z.enum(LLM_LINE_TYPES),
  text: z.string(),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  amount: z.number(),
  /** Indeks baris (1-based) yang dikenai diskon/void. */
  applies_to: z.number().nullable(),
  barcode: z.string().nullable(),
  member_discount: z.boolean(),
  bundle: z.boolean(),
  confidence: z.number(),
});

export const LlmReceiptSchema = z.object({
  document: DocumentSchema,
  store: StoreSchema,
  header: z.object({
    date: z.string().nullable(),
    time: z.string().nullable(),
    total: z.number().nullable(),
    subtotal: z.number().nullable(),
    payment_method: z.enum(LLM_PAYMENT_METHODS).nullable(),
    confidence: z.object({ date: z.number(), time: z.number(), total: z.number(), subtotal: z.number() }),
  }),
  lines: z.array(LlmReceiptLineSchema),
  adjustments: z.array(
    z.object({
      kind: z.enum(['voucher', 'cashback', 'points', 'other']),
      text: z.string().nullable(),
      amount: z.number().nullable(),
      points: z.number().nullable(),
    }),
  ),
  member: z.object({ text: z.string(), program: z.string().nullable() }).nullable(),
  pii: z.object({
    card_last4: z.string().nullable(),
    card_masked: z.string().nullable(),
    phone: z.string().nullable(),
    member_id: z.string().nullable(),
    member_name: z.string().nullable(),
    customer_name: z.string().nullable(),
    email: z.string().nullable(),
  }),
  /** Semua baris tercetak, PII diganti [REDAKSI] (§9 lapis 1, F-110). */
  transcript: z.string(),
});

export const LlmObservationItemSchema = z.object({
  /** Gambar ke- (1-based) tempat item ini terlihat. */
  image_position: z.number(),
  /** Nama produk seperti tercetak di label / nama produk di listing. */
  text: z.string(),
  listing_title: z.string().nullable(),
  listing_url: z.string().nullable(),
  barcode: z.string().nullable(),
  normal_price: z.number().nullable(),
  promo_price: z.number().nullable(),
  promo_min_qty: z.number().nullable(),
  promo_valid_from: z.string().nullable(),
  promo_valid_until: z.string().nullable(),
  member_price: z.number().nullable(),
  member_program: z.string().nullable(),
  seller_name: z.string().nullable(),
  seller_ref: z.string().nullable(),
  shipping_fee: z.number().nullable(),
  shop_voucher: z.number().nullable(),
  cashback: z.number().nullable(),
  points: z.number().nullable(),
  transaction_date: z.string().nullable(),
  /** Kotak item di gambar, pecahan 0–1. */
  region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
  bundle: z.boolean(),
  confidence: z.object({ product: z.number(), price: z.number(), date: z.number() }),
});

export const LlmObservationSchema = z.object({
  document: DocumentSchema,
  store: StoreSchema,
  items: z.array(LlmObservationItemSchema),
  transcript: z.string(),
});

export type LlmReceipt = z.infer<typeof LlmReceiptSchema>;
export type LlmReceiptLine = z.infer<typeof LlmReceiptLineSchema>;
export type LlmObservation = z.infer<typeof LlmObservationSchema>;
export type LlmObservationItem = z.infer<typeof LlmObservationItemSchema>;
export type LlmOutput = LlmReceipt | LlmObservation;

export function llmSchemaFor(kind: CaptureKind): z.ZodType<LlmOutput> {
  return kind === 'receipt' ? LlmReceiptSchema : LlmObservationSchema;
}
