import { z } from 'zod';

// Bentuk output extractor (docs/05 §5.4), dikunci di sini supaya stub (Tahap 4),
// VisionExtractor / OcrThenParseExtractor (Tahap 6), dan worker memakai kontrak sama.

const Confidence = z.number().min(0).max(1);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const CaptureKindSchema = z.enum(['receipt', 'price_label', 'marketplace']);
export type CaptureKind = z.infer<typeof CaptureKindSchema>;

export const StoreHintSchema = z.object({
  name: z.string().nullish(),
  branch_name: z.string().nullish(),
});

export const ReceiptLineTypeSchema = z.enum(['product', 'discount', 'void', 'non_product', 'tax', 'other']);

export const ParsedReceiptLineSchema = z.object({
  line_no: z.number().int().min(1),
  line_type: ReceiptLineTypeSchema,
  /** Deskripsi item saja (Q-28): kuantitas/harga yang tercetak di baris dipisah parser. */
  raw_text: z.string(),
  quantity: z.number().positive().nullish(),
  unit_amount: z.number().nullish(),
  line_amount: z.number(),
  applies_to_line_no: z.number().int().min(1).nullish(),
  barcode: z.string().nullish(),
  parse_confidence: Confidence.nullish(),
  is_bundle: z.boolean().optional(),
});

export const ReceiptFieldConfidenceSchema = z
  .object({
    store: Confidence, branch: Confidence, date: Confidence, time: Confidence, total: Confidence, subtotal: Confidence,
  })
  .partial();

export const ParsedReceiptSchema = z
  .object({
    kind: z.literal('receipt'),
    store_hint: StoreHintSchema.optional(),
    header: z.object({
      transaction_date: IsoDate.nullish(),
      transaction_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullish(),
      total_amount: z.number().nullish(),
      subtotal_amount: z.number().nullish(),
      payment_method: z.string().nullish(),
      currency: z.string().regex(/^[A-Z]{3}$/).nullish(),
      field_confidence: ReceiptFieldConfidenceSchema.default({}),
    }),
    /** PII terpisah (§6, D-64): digit kartu, nama/nomor member, HP. Tidak pernah dicatat di log. */
    pii: z.record(z.string(), z.string()).default({}),
    lines: z.array(ParsedReceiptLineSchema),
    adjustments: z
      .array(
        z.object({
          kind: z.enum(['voucher', 'cashback', 'points', 'shipping', 'other']),
          description: z.string().nullish(),
          amount: z.number().nullish(),
          points: z.number().nullish(),
        }),
      )
      .default([]),
    member_hint: z.object({ text: z.string(), program_name: z.string().nullish() }).optional(),
  })
  .superRefine((r, ctx) => {
    const nos = new Set(r.lines.map((l) => l.line_no));
    if (nos.size !== r.lines.length) ctx.addIssue({ code: 'custom', message: 'line_no harus unik' });
    for (const l of r.lines) {
      if ((l.line_type === 'discount' || l.line_type === 'void') && (l.applies_to_line_no == null || !nos.has(l.applies_to_line_no))) {
        ctx.addIssue({ code: 'custom', message: `baris ${l.line_no}: diskon/void wajib menempel ke baris yang ada` });
      }
    }
  });

export const RegionSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1),
});

export const ParsedObservationItemSchema = z.object({
  raw_text: z.string(),
  barcode: z.string().nullish(),
  normal_price: z.number().min(0).nullish(),
  promo_price: z.number().min(0).nullish(),
  promo_min_qty: z.number().int().min(2).nullish(),
  promo_valid_from: IsoDate.nullish(),
  promo_valid_until: IsoDate.nullish(),
  member_price: z.number().min(0).nullish(),
  member_program_name: z.string().nullish(),
  seller_name: z.string().nullish(),
  seller_ref: z.string().nullish(),
  shipping_fee: z.number().min(0).nullish(),
  shop_voucher: z.number().min(0).nullish(),
  cashback: z.number().min(0).nullish(),
  points: z.number().min(0).nullish(),
  listing_title: z.string().max(500).nullish(),
  listing_url: z.string().max(2000).startsWith('https://').nullish(),
  region: RegionSchema.nullish(),
  image_position: z.number().int().min(1).nullish(),
  /** Screenshot: tanggal dari metadata gambar jika ada. Default: tanggal unggah (D-60). */
  transaction_date: IsoDate.nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullish(),
  is_bundle: z.boolean().optional(),
  field_confidence: z.object({ product: Confidence, price: Confidence, date: Confidence, store: Confidence }).partial().default({}),
});

export const ParsedObservationSchema = z.object({
  kind: z.enum(['price_label', 'marketplace']),
  store_hint: StoreHintSchema.optional(),
  items: z.array(ParsedObservationItemSchema),
});

export const ParsedOutputSchema = z.union([ParsedReceiptSchema, ParsedObservationSchema]);

export type ParsedReceipt = z.infer<typeof ParsedReceiptSchema>;
export type ParsedReceiptLine = z.infer<typeof ParsedReceiptLineSchema>;
export type ParsedObservation = z.infer<typeof ParsedObservationSchema>;
export type ParsedObservationItem = z.infer<typeof ParsedObservationItemSchema>;
export type ParsedOutput = z.infer<typeof ParsedOutputSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().min(0).nullish(),
  outputTokens: z.number().int().min(0).nullish(),
  costUsd: z.number().min(0).nullish(),
});

/** Hasil CaptureExtractor.extract (docs/05 §5.4). */
export interface Extraction {
  rawText?: string | null;
  output: ParsedOutput;
  usage?: z.infer<typeof UsageSchema>;
}

// Hasil matching (tier 1–3 dari app.match_products, tier 4 dari AiMatcher).
export const MatchTierSchema = z.enum(['barcode', 'alias', 'fuzzy', 'ai', 'manual']);
export const MatchCandidateSchema = z.object({
  product_id: Uuid,
  tier: MatchTierSchema,
  confidence: Confidence,
});
export const MatchResultSchema = z.object({
  product_id: Uuid.nullable(),
  tier: MatchTierSchema.nullable(),
  confidence: Confidence.nullable(),
  candidates: z.array(MatchCandidateSchema).max(5),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;

/** Payload app.apply_extraction: output parser + hasil matching per baris/item. */
export type ApplyPayload =
  | (Omit<ParsedReceipt, 'lines'> & { lines: (ParsedReceiptLine & { match?: MatchResult })[] })
  | (Omit<ParsedObservation, 'items'> & { items: (ParsedObservationItem & { match?: MatchResult })[] });
