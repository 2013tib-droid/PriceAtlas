import { z } from 'zod';
import { PriceExtraSchema } from './extra.ts';

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
