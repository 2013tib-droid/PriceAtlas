// Skema kontrak per kunci fixture (test/fixtures/rpc.json). Satu sumber untuk test L3 (keluaran
// server lolos skema) dan test komponen (fixture divalidasi sebelum dipakai).
import {
  BarcodeHitSchema,
  CaptureDetailSchema,
  CaptureListItemSchema,
  ChartPointSchema,
  ClientConfigSchema,
  CompareSizesRowSchema,
  MyContextSchema,
  PriceRecordViewSchema,
  ProductCardSchema,
  ProductDetailSchema,
  SearchResultSchema,
  WhereCheaperRowSchema,
} from '@priceatlas/contracts';
import { z } from 'zod';
import { RecentPriceSchema } from '@/lib/data/rest-schemas';

const RpcErrorFixture = z.object({
  error: z.object({
    message: z.string(),
    code: z.string().nullable(),
    details: z.string().nullable(),
    hint: z.string().nullable(),
  }),
});

const search = z.array(SearchResultSchema);
const history = z.array(PriceRecordViewSchema);
const sizes = z.array(CompareSizesRowSchema);
const cheaper = z.array(WhereCheaperRowSchema);
const chart = z.array(ChartPointSchema);

export const FIXTURE_SCHEMAS: Record<string, z.ZodType> = {
  context: MyContextSchema,
  config: ClientConfigSchema,
  search_milo: search,
  search_indomie: search,
  search_jeruk: search,
  search_gula: search,
  search_none: search,
  search_milo_empty: search,
  cards_viewed: z.array(ProductCardSchema),
  detail_milo200: ProductDetailSchema,
  detail_milo500: ProductDetailSchema,
  detail_milo3in1: ProductDetailSchema,
  detail_miloUht: ProductDetailSchema,
  detail_indomie: ProductDetailSchema,
  detail_jeruk: ProductDetailSchema,
  detail_gula: ProductDetailSchema,
  detail_milo1kg: ProductDetailSchema,
  detail_miloDup: ProductDetailSchema,
  detail_unknown: RpcErrorFixture,
  chart_milo200: chart,
  chart_milo200_normal: chart,
  chart_jeruk: chart,
  history_milo200: history,
  history_milo200_page2: history,
  history_milo200_void: history,
  history_milo200_aeon: history,
  history_jeruk: history,
  history_miloUht: history,
  sizes_milo_90d: sizes,
  sizes_milo_all: sizes,
  sizes_milo_empty: sizes,
  sizes_unknown: RpcErrorFixture,
  cheaper_milo200_90: cheaper,
  cheaper_milo200_all: cheaper,
  cheaper_group_90: cheaper,
  cheaper_group_all: cheaper,
  cheaper_milo3in1_90: cheaper,
  cheaper_milo3in1_all: cheaper,
  barcode_milo500: BarcodeHitSchema,
  barcode_via_merge: BarcodeHitSchema,
  barcode_unknown: BarcodeHitSchema,
  recent_prices: z.array(RecentPriceSchema),
  recent_prices_empty: z.array(RecentPriceSchema).length(0),
  captures_all: z.array(CaptureListItemSchema).length(5),
  captures_receipt: z.array(CaptureListItemSchema).length(3),
  captures_empty: z.array(CaptureListItemSchema).length(0),
  capture_needs: CaptureDetailSchema,
  capture_failed: CaptureDetailSchema,
  capture_done: CaptureDetailSchema,
  capture_processing: CaptureDetailSchema,
  capture_uploaded: CaptureDetailSchema,
  capture_purged: CaptureDetailSchema,
  capture_unknown: RpcErrorFixture,
  retry_not_failed: RpcErrorFixture,
  delete_not_allowed: RpcErrorFixture,
};
