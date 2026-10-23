import { z } from 'zod';
import { PriceExtraSchema } from './extra.ts';
import { CaptureKindSchema } from './parsed.ts';

// Kontrak RPC (docs/05 §3.2). Input = parameter RPC PostgreSQL (nama p_*).
// Output dibuat longgar (passthrough) untuk field tambahan, tetapi field yang
// dipakai klien/tools wajib ada dengan tipe yang benar.

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Timestamp = z.string();
const Num = z.number();

// ---------------------------------------------------------------------------
// Bentuk berulang
// ---------------------------------------------------------------------------
export const StoreRefSchema = z.looseObject({ id: Uuid, name: z.string(), channel: z.enum(['offline', 'online']), is_private: z.boolean() });
export const BranchRefSchema = z.looseObject({ id: Uuid, name: z.string(), status: z.enum(['open', 'closed']) });

export const PricePointSchema = z.looseObject({
  record_id: Uuid,
  effective_price: Num,
  unit_price: Num,
  price_basis: z.enum(['normal', 'promo', 'member']),
  member_program_name: z.string().nullable(),
  date: IsoDate,
  store: StoreRefSchema,
  branch: BranchRefSchema.nullable(),
});

export const ProductLiteSchema = z.looseObject({
  id: Uuid,
  name: z.string(),
  variant: z.string().nullable(),
  sale_mode: z.enum(['unit', 'weight']),
  pack_count: Num,
  content_size: Num.nullable(),
  content_unit: z.string(),
  dimension: z.enum(['mass', 'volume', 'count', 'length']),
  base_unit: z.enum(['g', 'ml', 'pcs', 'm']),
  is_private: z.boolean(),
  brand_name: z.string().nullable(),
  category_name: z.string().nullable(),
  status: z.enum(['active', 'merged', 'archived']),
  product_group_id: Uuid.nullable(),
});

export const ProductCardSchema = z.looseObject({
  product: ProductLiteSchema,
  group: z.looseObject({
    id: Uuid,
    name: z.string(),
    best_by_dimension: z.looseObject({ unit_price: Num, product_id: Uuid }).nullable(),
  }).nullable(),
  summary: z.looseObject({
    record_count: Num,
    last_transaction_date: IsoDate,
    last_effective_price: Num,
    last_unit_price: Num,
    best_90d: PricePointSchema.nullable(),
    best_all: PricePointSchema,
    trend_direction: z.enum(['up', 'down', 'flat']).nullable(),
    trend_pct: Num.nullable(),
    refreshed_at: Timestamp,
  }).nullable(),
  hints: z.looseObject({
    member_not_counted: z
      .looseObject({ member_price: Num, program_name: z.string(), store_name: z.string(), record_id: Uuid, date: IsoDate })
      .nullable(),
    bundle_only_count: Num,
  }),
});
export type ProductCard = z.infer<typeof ProductCardSchema>;

export const SearchResultSchema = ProductCardSchema.extend({ match_score: Num });

export const PriceTrendSchema = z.looseObject({
  cur_avg: Num.nullable(), cur_n: Num, prev_avg: Num.nullable(), prev_n: Num,
  pct: Num.nullable(), direction: z.enum(['up', 'down', 'flat']).nullable(),
  label: z.literal('vs 30 hari sebelumnya'),
  min_records_per_window: Num,
  record_count: Num, last_date: IsoDate.nullable(),
});
export type PriceTrend = z.infer<typeof PriceTrendSchema>;

export const ProductDetailSchema = z.looseObject({
  redirect_to: Uuid.nullable(),
  card: ProductCardSchema,
  last_record: z.looseObject({
    record_id: Uuid, store: StoreRefSchema, branch: BranchRefSchema.nullable(), date: IsoDate,
    effective_price: Num, price_basis: z.enum(['normal', 'promo', 'member']),
  }).nullable(),
  trend_windows: z.looseObject({ cur_n: Num, prev_n: Num, cur_avg: Num.nullable(), prev_avg: Num.nullable() }),
  group_sizes_count: Num,
});
export type ProductDetail = z.infer<typeof ProductDetailSchema>;

export const PriceRecordViewSchema = z.looseObject({
  id: Uuid,
  product_id: Uuid,
  store_id: Uuid,
  branch_id: Uuid.nullable(),
  source_type: z.enum(['receipt', 'price_label', 'marketplace']),
  transaction_date: IsoDate,
  currency: z.string(),
  quantity: Num,
  actual_weight: Num.nullable(),
  normal_price: Num.nullable(),
  promo_price: Num.nullable(),
  promo_min_qty: Num.nullable(),
  promo_valid_from: IsoDate.nullable(),
  promo_valid_until: IsoDate.nullable(),
  member_price: Num.nullable(),
  effective_price: Num,
  price_basis: z.enum(['normal', 'promo', 'member']),
  unit_price: Num,
  is_bundle: z.boolean(),
  status: z.enum(['active', 'void']),
  extra: PriceExtraSchema,
  store_name: z.string(),
  store_channel: z.enum(['offline', 'online']),
  branch_name: z.string().nullable(),
  branch_status: z.enum(['open', 'closed']).nullable(),
  member_program_name: z.string().nullable(),
  member_not_counted: z.boolean(),
  normal_unit_price: Num.nullable(),
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type PriceRecordView = z.infer<typeof PriceRecordViewSchema>;

/** R9 price_chart: satu titik per record aktif non-bundle (D-08, D-33). */
export const ChartPointSchema = z.looseObject({
  date: IsoDate, unit_price: Num, price_basis: z.enum(['normal', 'promo', 'member']), record_id: Uuid,
});
export type ChartPoint = z.infer<typeof ChartPointSchema>;

/** R2 get_client_config: hanya kunci whitelist app.config. */
export const ClientConfigSchema = z.looseObject({
  best_price_window_days: Num, trend_window_days: Num, trend_min_records_per_window: Num,
  trend_flat_threshold_pct: Num, auto_save_min_confidence: Num, near_best_threshold_pct: Num,
  session_extend_hours: Num, image_retention_months: Num,
});
export type ClientConfig = z.infer<typeof ClientConfigSchema>;

/** R6 find_product_by_barcode (D-58): null jika tidak dikenal. */
export const BarcodeHitSchema = z.looseObject({ product_id: Uuid, via_merge: z.boolean() }).nullable();
export type BarcodeHit = z.infer<typeof BarcodeHitSchema>;

export const CompareSizesRowSchema = z.looseObject({
  product: ProductLiteSchema, dimension: z.string(), currency: z.string(),
  unit_price: Num.nullable(), effective_price: Num.nullable(), price_basis: z.enum(['normal', 'promo', 'member']).nullable(),
  per_pack_price: Num.nullable(),
  store: StoreRefSchema.nullable(), branch: BranchRefSchema.nullable(), date: IsoDate.nullable(),
  last_transaction_date: IsoDate.nullable(), rank: Num.nullable(), pct_vs_best: Num.nullable(),
  has_data: z.boolean(), other_currency: z.boolean(),
});
export type CompareSizesRow = z.infer<typeof CompareSizesRowSchema>;

export const WhereCheaperRowSchema = z.looseObject({
  dimension: z.string(), currency: z.string(), store: StoreRefSchema, branch: BranchRefSchema.nullable(),
  successor_branch: BranchRefSchema.nullable(), min_unit_price: Num, avg_unit_price: Num, n: Num,
  last_date: IsoDate, is_online: z.boolean(),
});
export type WhereCheaperRow = z.infer<typeof WhereCheaperRowSchema>;

// ---------------------------------------------------------------------------
// R13 list_captures · R14 get_capture (S-08, S-09; docs/05 §3.3)
// ---------------------------------------------------------------------------
export const CaptureStatusSchema = z.enum(['uploaded', 'processing', 'needs_confirmation', 'done', 'failed']);
/** capture.error_code (D-71). */
export const CaptureErrorCodeSchema = z.enum(['blurry', 'not_a_receipt', 'unsupported', 'timeout', 'other']);

export const CaptureListItemSchema = z.looseObject({
  id: Uuid,
  kind: CaptureKindSchema,
  status: CaptureStatusSchema,
  store_name: z.string().nullable(),
  branch_name: z.string().nullable(),
  date: IsoDate,
  date_is_upload: z.boolean(),
  needs_check_count: Num,
  saved_count: Num,
  error_message: z.string().nullable(),
  error_code: CaptureErrorCodeSchema.nullable(),
  attempts: Num,
  uploaded_at: Timestamp,
  receipt_id: Uuid.nullable(),
});
export type CaptureListItem = z.infer<typeof CaptureListItemSchema>;

export const CaptureDetailSchema = z.looseObject({
  capture: z.looseObject({
    id: Uuid,
    kind: CaptureKindSchema,
    status: CaptureStatusSchema,
    store_id: Uuid.nullable(),
    branch_id: Uuid.nullable(),
    shopping_session_id: Uuid.nullable(),
    uploaded_at: Timestamp,
    processed_at: Timestamp.nullable(),
    captured_at: Timestamp.nullable(),
    error_message: z.string().nullable(),
    error_code: CaptureErrorCodeSchema.nullable(),
  }),
  images: z.array(z.looseObject({
    position: Num, storage_path: z.string(), purged_at: Timestamp.nullable(), sha256: z.string(),
  })),
  runs: z.array(z.looseObject({
    id: Uuid,
    status: z.enum(['running', 'succeeded', 'failed']),
    started_at: Timestamp,
    finished_at: Timestamp.nullable(),
    error_message: z.string().nullable(),
  })),
  receipt_id: Uuid.nullable(),
  saved_records: z.array(PriceRecordViewSchema),
});
export type CaptureDetail = z.infer<typeof CaptureDetailSchema>;

// ---------------------------------------------------------------------------
// R15 get_receipt · R16 get_capture_items · R17 recent_locations (S-10, S-11, S-12; docs/05 §3.3)
// ---------------------------------------------------------------------------
const PriceBasis = z.enum(['normal', 'promo', 'member']);
const Confidence = z.number().min(0).max(1);
const MatchTier = z.enum(['barcode', 'alias', 'fuzzy', 'ai', 'manual']);

/** app.branch_json: BranchRef + kind + is_private (S-12 badge PRIBADI, seller marketplace). */
export const BranchJsonSchema = BranchRefSchema.extend({ kind: z.enum(['physical', 'seller']), is_private: z.boolean() });

const ReceiptLineTypeOut = z.enum(['product', 'discount', 'void', 'non_product', 'tax', 'other']);

/** Baris diskon/void yang menempel ke baris produk (applies_to_line_id). */
export const ReceiptAttachedLineSchema = z.looseObject({
  id: Uuid, line_no: Num, line_type: ReceiptLineTypeOut, raw_text: z.string().nullable(),
  quantity: Num.nullable(), line_amount: Num, updated_at: Timestamp,
});

export const ReceiptLineSchema = z.looseObject({
  id: Uuid,
  line_no: Num,
  line_type: ReceiptLineTypeOut,
  raw_text: z.string().nullable(),
  quantity: Num.nullable(),
  unit_amount: Num.nullable(),
  line_amount: Num,
  updated_at: Timestamp,
  match_tier: MatchTier.nullable(),
  match_confidence: Num.nullable(),
  attached: z.array(ReceiptAttachedLineSchema),
  /** ProductCard-lite (app.product_lite) dari suggested_product_id. */
  suggestion: ProductLiteSchema.nullable(),
  record: PriceRecordViewSchema.nullable(),
  /** Baris produk tanpa record di struk draft. */
  needs_check: z.boolean(),
});
export type ReceiptLine = z.infer<typeof ReceiptLineSchema>;

export const ReceiptStatusSchema = z.enum(['draft', 'confirmed', 'discarded']);

export const ReceiptDetailSchema = z.looseObject({
  header: z.looseObject({
    id: Uuid,
    status: ReceiptStatusSchema,
    capture_id: Uuid.nullable(),
    store: StoreRefSchema.nullable(),
    branch: BranchJsonSchema.nullable(),
    transaction_date: IsoDate.nullable(),
    transaction_time: z.string().nullable(),
    currency: z.string(),
    subtotal_amount: Num.nullable(),
    total_amount: Num.nullable(),
    payment_method: z.string().nullable(),
    confirmed_at: Timestamp.nullable(),
    updated_at: Timestamp,
  }),
  /** receipt.field_confidence (D-49): store, branch, date, time, total, subtotal. */
  field_confidence: z.record(z.string(), Confidence).nullable(),
  uploaded_at: Timestamp.nullable(),
  images: z.array(z.looseObject({ position: Num, storage_path: z.string(), purged_at: Timestamp.nullable() })),
  totals: z.looseObject({ lines_sum: Num, total_amount: Num.nullable(), diff: Num.nullable() }),
  /** Struk lain yang dicurigai sama (D-20); null jika tidak ada. */
  duplicate: z.looseObject({ receipt_id: Uuid, store: StoreRefSchema.nullable(), date: IsoDate.nullable(), total: Num.nullable() }).nullable(),
  lines: z.array(ReceiptLineSchema),
  adjustments: z.array(z.looseObject({
    id: Uuid, kind: z.enum(['voucher', 'cashback', 'points', 'shipping', 'other']), description: z.string().nullable(),
    amount: Num.nullable(), points: Num.nullable(),
  })),
  /** Diskon bertanda member (D-63, D-74); program_id jika toko punya tepat satu program aktif. */
  member_hint: z.looseObject({ text: z.string(), program_id: Uuid.optional() }).nullable(),
  membership_known: z.boolean(),
});
export type ReceiptDetail = z.infer<typeof ReceiptDetailSchema>;

/** W4 confirm_receipt. */
export const ConfirmReceiptResultSchema = z.looseObject({
  saved_count: Num, cheaper_than_best_count: Num, receipt_status: ReceiptStatusSchema, replayed: z.boolean().optional(),
});
export type ConfirmReceiptResult = z.infer<typeof ConfirmReceiptResultSchema>;

/** R16: capture_item + suggestion, candidates (≤ 5), computed live (D-26) untuk item pending. */
export const CaptureItemSchema = z.looseObject({
  id: Uuid,
  capture_id: Uuid,
  position: Num,
  status: z.enum(['pending', 'accepted', 'rejected']),
  raw_text: z.string().nullable(),
  image_position: Num.nullable(),
  region: z.looseObject({ x: Num, y: Num, w: Num, h: Num }).nullable(),
  suggested_product_id: Uuid.nullable(),
  candidate_product_ids: z.array(Uuid).nullable(),
  match_tier: MatchTier.nullable(),
  match_confidence: Num.nullable(),
  store_id: Uuid.nullable(),
  branch_id: Uuid.nullable(),
  seller_name: z.string().nullable(),
  seller_ref: z.string().nullable(),
  transaction_date: IsoDate,
  currency: z.string(),
  normal_price: Num.nullable(),
  promo_price: Num.nullable(),
  promo_min_qty: Num.nullable(),
  promo_valid_from: IsoDate.nullable(),
  promo_valid_until: IsoDate.nullable(),
  member_price: Num.nullable(),
  member_program_id: Uuid.nullable(),
  is_bundle: z.boolean(),
  extra: PriceExtraSchema,
  field_confidence: z.record(z.string(), Confidence).nullable(),
  price_record_id: Uuid.nullable(),
  updated_at: Timestamp,
  suggestion: ProductLiteSchema.nullable(),
  candidates: z.array(ProductLiteSchema),
  computed: z.looseObject({
    effective_price: Num.nullable(),
    price_basis: PriceBasis.nullable(),
    member_eligible: z.boolean().nullable(),
    reason: z.literal('no_applicable_price').nullable(),
    unit_price: Num.nullable(),
  }).nullable(),
  needs_check: z.boolean(),
});
export type CaptureItem = z.infer<typeof CaptureItemSchema>;

/** W5 confirm_capture_items. */
export const ConfirmCaptureItemsResultSchema = z.looseObject({
  saved: z.array(z.looseObject({ item_id: Uuid, price_record_id: Uuid })), remaining_pending: Num,
});
export type ConfirmCaptureItemsResult = z.infer<typeof ConfirmCaptureItemsResultSchema>;

/** R17 recent_locations (S-12 "Terakhir dipakai"). */
export const RecentLocationSchema = z.looseObject({
  store: StoreRefSchema, branch: BranchJsonSchema.nullable(), last_used: Timestamp,
});
export type RecentLocation = z.infer<typeof RecentLocationSchema>;

/** R21 get_my_programs (S-11 nama program member + "Saya member"; S-19b di M6). */
export const MyProgramSchema = z.looseObject({
  program_id: Uuid, program_name: z.string(), status: z.enum(['active', 'discontinued']), store: StoreRefSchema,
  is_member: z.boolean(),
});
export type MyProgram = z.infer<typeof MyProgramSchema>;

// ---------------------------------------------------------------------------
// R18 get_active_session · W11/W12/W13 (S-12 mode sesi, S-13, banner sesi; docs/05 §3.3)
// ---------------------------------------------------------------------------
/**
 * Satu baris label sesi: per capture sesi dan per item yang tidak ditolak. Capture tanpa item
 * (uploaded/processing/failed) → `item_id` null. Harga = record tersimpan, atau `computed` live untuk
 * item pending (app.observation_price). vs_*_pct terhadap price_summary saat ini (1 desimal).
 */
export const SessionLabelSchema = z.looseObject({
  capture_id: Uuid,
  status: CaptureStatusSchema,
  item_id: Uuid.nullable(),
  product: ProductLiteSchema.nullable(),
  effective_price: Num.nullable(),
  price_basis: PriceBasis.nullable(),
  vs_best_pct: Num.nullable(),
  vs_last_pct: Num.nullable(),
});
export type SessionLabel = z.infer<typeof SessionLabelSchema>;

export const SessionTimesSchema = z.looseObject({ id: Uuid, started_at: Timestamp, expires_at: Timestamp });
export type SessionTimes = z.infer<typeof SessionTimesSchema>;

/** R18 (dan hasil W11): sesi aktif = `ended_at IS NULL AND expires_at > now()`, selain itu null. */
export const ActiveSessionSchema = z
  .looseObject({
    session: SessionTimesSchema,
    store: StoreRefSchema,
    branch: BranchJsonSchema,
    labels: z.array(SessionLabelSchema),
  })
  .nullable();
export type ActiveSession = NonNullable<z.infer<typeof ActiveSessionSchema>>;

/** W13 end_shopping_session (idempoten: sesi yang sudah berakhir → sukses). */
export const EndedSessionSchema = SessionTimesSchema.extend({ ended_at: Timestamp.nullable() });
export type EndedSession = z.infer<typeof EndedSessionSchema>;

// ---------------------------------------------------------------------------
// Input RPC tulis (§3.2, §4)
// ---------------------------------------------------------------------------
export const SubmitCaptureInput = z.object({
  p_capture_id: Uuid,
  p_kind: z.enum(['receipt', 'price_label', 'marketplace']),
  p_images: z.array(z.object({
    position: z.number().int().min(1),
    ext: z.enum(['jpg', 'jpeg', 'png', 'webp', 'heic']),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    byte_size: z.number().int().positive().max(10 * 1024 * 1024),
  })).min(1),
  p_shopping_session_id: Uuid.nullish(),
  p_store_id: Uuid.nullish(),
  p_branch_id: Uuid.nullish(),
  p_captured_at: Timestamp.nullish(),
});

export const ConfirmReceiptInput = z.object({
  p_receipt_id: Uuid,
  p_lines: z.array(z.object({
    line_id: Uuid,
    action: z.enum(['accept', 'replace', 'non_product', 'skip']),
    product_id: Uuid.optional(),
    is_bundle: z.boolean().optional(),
  }).refine((d) => d.action !== 'replace' || d.product_id, 'replace wajib product_id')),
  p_duplicate_decision: z.enum(['distinct', 'discard']).nullish(),
});

export const ConfirmCaptureItemsInput = z.object({
  p_capture_id: Uuid,
  p_items: z.array(z.object({ item_id: Uuid, action: z.enum(['accept', 'reject']), product_id: Uuid.optional() })),
});

const CaptureItemPatch = z.strictObject({
  product_id: Uuid, store_id: Uuid.nullable(), branch_id: Uuid.nullable(), seller_name: z.string().nullable(),
  seller_ref: z.string().nullable(), transaction_date: IsoDate, currency: z.string().regex(/^[A-Z]{3}$/),
  normal_price: Num.min(0).nullable(), promo_price: Num.min(0).nullable(), promo_min_qty: z.number().int().min(2).nullable(),
  promo_valid_from: IsoDate.nullable(), promo_valid_until: IsoDate.nullable(), member_price: Num.min(0).nullable(),
  member_program_id: Uuid.nullable(), is_bundle: z.boolean(), extra: PriceExtraSchema,
}).partial();
export const UpdateCaptureItemInput = z.object({ p_item_id: Uuid, p_patch: CaptureItemPatch, p_expected_updated_at: Timestamp });

const PriceRecordPatch = z.strictObject({
  product_id: Uuid, is_bundle: z.boolean(), status: z.enum(['active', 'void']), extra: PriceExtraSchema,
  normal_price: Num.min(0).nullable(), promo_price: Num.min(0).nullable(), promo_min_qty: z.number().int().min(2).nullable(),
  promo_valid_from: IsoDate.nullable(), promo_valid_until: IsoDate.nullable(), member_price: Num.min(0).nullable(),
  member_program_id: Uuid.nullable(), transaction_date: IsoDate, store_id: Uuid, branch_id: Uuid.nullable(),
}).partial();
/** Kunci yang ditolak untuk record struk (USE_RECEIPT_LINE, D-23). */
export const RECEIPT_LOCKED_KEYS = ['normal_price', 'promo_price', 'promo_min_qty', 'promo_valid_from', 'promo_valid_until',
  'member_price', 'member_program_id', 'transaction_date', 'store_id', 'branch_id'] as const;
export const CorrectPriceRecordInput = z.object({
  p_id: Uuid, p_patch: PriceRecordPatch, p_expected_updated_at: Timestamp, p_update_alias: z.boolean().optional(),
});

export const CorrectReceiptLineInput = z.object({
  p_line_id: Uuid,
  p_patch: z.strictObject({
    quantity: Num.positive().nullable(), unit_amount: Num.nullable(), line_amount: Num,
    line_type: z.enum(['product', 'discount', 'void', 'non_product', 'tax', 'other']), applies_to_line_id: Uuid.nullable(),
    add_discount: z.object({ line_amount: Num, raw_text: z.string().optional() }),
  }).partial(),
  p_expected_updated_at: Timestamp,
});

export const CreatePrivateProductInput = z.object({
  p_product: z.object({
    id: Uuid.optional(),
    name: z.string().min(1),
    variant: z.string().nullish(),
    brand: z.union([z.object({ id: Uuid }), z.object({ new: z.string().min(1) })]).optional(),
    group: z.union([z.object({ id: Uuid }), z.object({ new: z.string().min(1) }), z.literal('same_as_name')]).optional(),
    category_id: Uuid.nullish(),
    sale_mode: z.enum(['unit', 'weight']).default('unit'),
    pack_count: z.number().int().min(1).default(1),
    content_size: Num.positive().nullish(),
    content_unit: z.string(),
    barcodes: z.array(z.object({ code: z.string(), code_type: z.enum(['gtin', 'plu']), store_id: Uuid.optional() })).default([]),
  }),
});

export const MovePriceRecordsInput = z.object({
  p_record_ids: z.array(Uuid).min(1),
  p_target_product_id: Uuid,
  p_alias: z.object({ store_id: Uuid, alias_text: z.string() }).nullish(),
});

export const SessionInput = z.object({ p_session_id: Uuid });
export const StartSessionInput = z.object({ p_session_id: Uuid, p_branch_id: Uuid });
export const SetSharePricesPublicInput = z.object({ p_enabled: z.boolean() });
export const SetProgramMembershipInput = z.object({ p_program_id: Uuid, p_member: z.boolean() });
export const CreatePrivateStoreInput = z.object({
  p_store: z.object({ id: Uuid.optional(), name: z.string().min(1), channel: z.enum(['offline', 'online']).default('offline') }),
});
export const CreatePrivateBranchInput = z.object({
  p_branch: z.object({
    id: Uuid.optional(), store_id: Uuid, kind: z.enum(['physical', 'seller']).default('physical'), name: z.string().min(1),
    address: z.string().nullish(), city: z.string().nullish(), region: z.string().nullish(), external_ref: z.string().nullish(),
  }),
});
export const MergeProductInput = z.object({ p_from: Uuid, p_into: Uuid });

// ---------------------------------------------------------------------------
// Input RPC baca
// ---------------------------------------------------------------------------
export const SearchProductsInput = z.object({ p_query: z.string().min(2).max(100), p_limit: z.number().int().min(1).max(50).optional() });
export const ProductIdInput = z.object({ p_product_id: Uuid });
export const PriceTrendInput = z.object({ p_product_id: Uuid, p_normal_only: z.boolean().optional() });
export const PriceHistoryInput = z.object({
  p_product_id: Uuid, p_include_void: z.boolean().optional(), p_store_id: Uuid.nullish(),
  p_limit: z.number().int().min(1).max(200).optional(), p_before_date: IsoDate.nullish(), p_before_id: Uuid.nullish(),
});
export const CompareSizesInput = z.object({ p_group_id: Uuid, p_window: z.enum(['90d', 'all']).optional() });
export const WhereCheaperInput = z
  .object({ p_product_id: Uuid.nullish(), p_group_id: Uuid.nullish(), p_window_days: z.number().int().positive().nullable().optional() })
  .refine((x) => (x.p_product_id == null) !== (x.p_group_id == null), 'Isi salah satu: produk atau group');

/**
 * Daftar RPC kontrak (docs/05 §3.2): R1–R21, W1–W18, dan fungsi khusus service role.
 * Test sql-equivalence memastikan daftar ini sama dengan fungsi di schema public.
 */
export const RPC_NAMES = {
  read: [
    'get_my_context', 'get_client_config', 'search_products', 'get_product_cards', 'get_offline_cache',
    'find_product_by_barcode', 'get_product_detail', 'price_history', 'price_chart', 'price_trend', 'compare_sizes',
    'where_cheaper', 'list_captures', 'get_capture', 'get_receipt', 'get_capture_items', 'recent_locations',
    'get_active_session', 'merge_product_preview', 'price_record_detail', 'get_my_programs',
  ],
  write: [
    'submit_capture', 'retry_capture', 'delete_capture', 'confirm_receipt', 'confirm_capture_items',
    'correct_price_record', 'correct_receipt_line', 'create_private_product', 'move_price_records', 'merge_product',
    'start_shopping_session', 'extend_shopping_session', 'end_shopping_session', 'set_share_prices_public',
    'share_existing_prices', 'set_program_membership', 'create_private_store', 'create_private_branch',
    'update_capture_item',
  ],
  serviceRole: ['begin_account_deletion'],
} as const;

// ---------------------------------------------------------------------------
// R1 konteks user (S-00a setelah login, docs/07 §3.5)
// ---------------------------------------------------------------------------
export const MyContextSchema = z.looseObject({
  user_id: Uuid,
  display_name: z.string().nullable(),
  household: z.looseObject({
    id: Uuid, name: z.string(), default_currency: z.string(), timezone: z.string(), share_prices_public: z.boolean(),
  }),
  role: z.string().nullable(),
  program_ids: z.array(Uuid),
});
export type MyContext = z.infer<typeof MyContextSchema>;

// ---------------------------------------------------------------------------
// Input semua RPC klien (rpcCall di apps/web memvalidasi lewat peta ini, docs/07 §3.4).
// Test sql-equivalence memastikan kuncinya = RPC_NAMES.read + write dan argumennya
// ada di fungsi SQL.
// ---------------------------------------------------------------------------
const NoArgs = z.object({});
const CaptureIdInput = z.object({ p_capture_id: Uuid });

export const RPC_INPUTS = {
  get_my_context: NoArgs,
  get_client_config: NoArgs,
  search_products: SearchProductsInput,
  get_product_cards: z.object({ p_ids: z.array(Uuid).max(50) }),
  get_offline_cache: z.object({ p_viewed_ids: z.array(Uuid).max(150).optional(), p_top: z.number().int().min(0).max(200).optional() }),
  find_product_by_barcode: z.object({ p_code: z.string().min(1).max(64), p_store_id: Uuid.nullish() }),
  get_product_detail: ProductIdInput,
  price_history: PriceHistoryInput,
  price_chart: PriceTrendInput,
  price_trend: PriceTrendInput,
  compare_sizes: CompareSizesInput,
  where_cheaper: WhereCheaperInput,
  list_captures: z.object({
    p_limit: z.number().int().min(1).max(100).optional(), p_before: Timestamp.nullish(),
    p_kind: z.enum(['receipt', 'price_label', 'marketplace']).nullish(),
  }),
  get_capture: CaptureIdInput,
  get_receipt: z.object({ p_receipt_id: Uuid }),
  get_capture_items: CaptureIdInput,
  recent_locations: z.object({ p_limit: z.number().int().min(1).max(50).optional() }),
  get_active_session: NoArgs,
  merge_product_preview: MergeProductInput,
  price_record_detail: z.object({ p_id: Uuid }),
  get_my_programs: NoArgs,
  submit_capture: SubmitCaptureInput,
  retry_capture: CaptureIdInput,
  delete_capture: CaptureIdInput,
  confirm_receipt: ConfirmReceiptInput,
  confirm_capture_items: ConfirmCaptureItemsInput,
  correct_price_record: CorrectPriceRecordInput,
  correct_receipt_line: CorrectReceiptLineInput,
  create_private_product: CreatePrivateProductInput,
  move_price_records: MovePriceRecordsInput,
  merge_product: MergeProductInput,
  start_shopping_session: StartSessionInput,
  extend_shopping_session: SessionInput,
  end_shopping_session: SessionInput,
  set_share_prices_public: SetSharePricesPublicInput,
  share_existing_prices: NoArgs,
  set_program_membership: SetProgramMembershipInput,
  create_private_store: CreatePrivateStoreInput,
  create_private_branch: CreatePrivateBranchInput,
  update_capture_item: UpdateCaptureItemInput,
} as const satisfies Record<(typeof RPC_NAMES)['read' | 'write'][number], z.ZodType>;

export type RpcName = keyof typeof RPC_INPUTS;
export type RpcInput<N extends RpcName> = z.input<(typeof RPC_INPUTS)[N]>;
