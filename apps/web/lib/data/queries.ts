'use client';
// Hook data per RPC (docs/07 §4.3): kunci qk.rpc(name, input), staleTime dari query-client
// (30 dtk untuk R3/R4/R7–R12, 1 jam untuk R2), di-persist ke IndexedDB. Output divalidasi skema
// kontrak di development/test (rpcCall).
import {
  BarcodeHitSchema,
  ChartPointSchema,
  ClientConfigSchema,
  CompareSizesRowSchema,
  PriceRecordViewSchema,
  ProductCardSchema,
  ProductDetailSchema,
  SearchResultSchema,
  WhereCheaperRowSchema,
  type BarcodeHit,
  type ChartPoint,
  type ClientConfig,
  type CompareSizesRow,
  type PriceRecordView,
  type ProductCard,
  type ProductDetail,
  type RpcInput,
  type WhereCheaperRow,
} from '@priceatlas/contracts';
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '@/lib/auth/session';
import { BADGE_IDLE_MS, listPollingActive, POLL_MS } from './captures';
import { qk } from './query-keys';
import { fetchNeedsCheckCount, fetchRecentPrices } from './rest';
import { rpcCall } from './rpc';

export type SearchResult = z.infer<typeof SearchResultSchema>;

function useSignedIn(): boolean {
  return useAuth().status === 'signed-in';
}

/** Kata kunci search seperti app.normalize_text (spasi tunggal); dikirim jika ≥ 2 huruf (R3, 22023). */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ');
}
export const MIN_QUERY = 2;

/** Nilai cadangan R2 jika config belum termuat (sama dengan app.config seed, D-44/D-55). */
export const DEFAULT_CONFIG: ClientConfig = {
  best_price_window_days: 90,
  trend_window_days: 30,
  trend_min_records_per_window: 2,
  trend_flat_threshold_pct: 2,
  auto_save_min_confidence: 0.9,
  near_best_threshold_pct: 5,
  session_extend_hours: 2,
  image_retention_months: 12,
};

export function useClientConfig() {
  const q = useQuery({
    queryKey: qk.rpc('get_client_config'),
    queryFn: () => rpcCall<'get_client_config', ClientConfig>('get_client_config', {}, { output: ClientConfigSchema }),
    enabled: useSignedIn(),
  });
  return { ...q, config: q.data ?? DEFAULT_CONFIG };
}

export function searchQuery(query: string) {
  const input: RpcInput<'search_products'> = { p_query: normalizeQuery(query) };
  return {
    queryKey: qk.rpc('search_products', input),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      rpcCall<'search_products', SearchResult[]>('search_products', input, {
        output: z.array(SearchResultSchema),
        signal,
      }),
  };
}

export function useSearch(query: string) {
  const enabled = useSignedIn() && normalizeQuery(query).length >= MIN_QUERY;
  // Hasil sebelumnya tetap tampil selama kata kunci baru dimuat (tanpa kedip skeleton per huruf).
  return useQuery({ ...searchQuery(query), enabled, placeholderData: (prev) => prev });
}

export function useProductCards(ids: readonly string[]) {
  const input: RpcInput<'get_product_cards'> = { p_ids: [...ids] };
  return useQuery({
    queryKey: qk.rpc('get_product_cards', input),
    queryFn: () =>
      rpcCall<'get_product_cards', ProductCard[]>('get_product_cards', input, { output: z.array(ProductCardSchema) }),
    enabled: useSignedIn() && ids.length > 0,
  });
}

export function useProductDetail(id: string | null) {
  const input: RpcInput<'get_product_detail'> = { p_product_id: id ?? '' };
  return useQuery({
    queryKey: qk.rpc('get_product_detail', input),
    queryFn: () =>
      rpcCall<'get_product_detail', ProductDetail>('get_product_detail', input, { output: ProductDetailSchema }),
    enabled: useSignedIn() && Boolean(id),
  });
}

export function usePriceChart(id: string | null, normalOnly: boolean) {
  const input: RpcInput<'price_chart'> = { p_product_id: id ?? '', p_normal_only: normalOnly };
  return useQuery({
    queryKey: qk.rpc('price_chart', input),
    queryFn: () => rpcCall<'price_chart', ChartPoint[]>('price_chart', input, { output: z.array(ChartPointSchema) }),
    enabled: useSignedIn() && Boolean(id),
  });
}

export const HISTORY_PAGE = 20;
type HistoryCursor = { date: string; id: string } | null;

/** R8 dengan cursor (transaction_date, id) dari baris terakhir halaman sebelumnya. */
export function usePriceHistory(id: string | null, opts: { storeId?: string | null; includeVoid?: boolean } = {}) {
  const base = {
    p_product_id: id ?? '',
    p_store_id: opts.storeId ?? null,
    p_include_void: opts.includeVoid ?? false,
    p_limit: HISTORY_PAGE,
  } satisfies RpcInput<'price_history'>;
  return useInfiniteQuery({
    queryKey: qk.rpc('price_history', base),
    initialPageParam: null as HistoryCursor,
    queryFn: ({ pageParam }) =>
      rpcCall<'price_history', PriceRecordView[]>(
        'price_history',
        { ...base, p_before_date: pageParam?.date ?? null, p_before_id: pageParam?.id ?? null },
        { output: z.array(PriceRecordViewSchema) },
      ),
    getNextPageParam: (last): HistoryCursor => {
      const tail = last[last.length - 1];
      return last.length < HISTORY_PAGE || !tail ? null : { date: tail.transaction_date, id: tail.id };
    },
    enabled: useSignedIn() && Boolean(id),
  });
}

export function useCompareSizes(groupId: string | null, window: '90d' | 'all') {
  const input: RpcInput<'compare_sizes'> = { p_group_id: groupId ?? '', p_window: window };
  return useQuery({
    queryKey: qk.rpc('compare_sizes', input),
    queryFn: () =>
      rpcCall<'compare_sizes', CompareSizesRow[]>('compare_sizes', input, { output: z.array(CompareSizesRowSchema) }),
    enabled: useSignedIn() && Boolean(groupId),
  });
}

/** R12: salah satu produk atau group; `windowDays` null = sepanjang masa. */
export function useWhereCheaper(
  scope: { productId?: string | null; groupId?: string | null },
  windowDays: number | null,
) {
  const input: RpcInput<'where_cheaper'> = scope.productId
    ? { p_product_id: scope.productId, p_window_days: windowDays }
    : { p_group_id: scope.groupId ?? null, p_window_days: windowDays };
  return useQuery({
    queryKey: qk.rpc('where_cheaper', input),
    queryFn: () =>
      rpcCall<'where_cheaper', WhereCheaperRow[]>('where_cheaper', input, { output: z.array(WhereCheaperRowSchema) }),
    enabled: useSignedIn() && Boolean(scope.productId || scope.groupId),
  });
}

/**
 * R6 (D-58, docs/07 §5.7): sekali panggil dari jendela bidik; tidak di-cache lama. Saat sesi belanja
 * aktif, toko sesi ikut dikirim (PLU/barcode internal toko).
 */
export function findProductByBarcode(qc: QueryClient, code: string, storeId?: string | null): Promise<BarcodeHit> {
  const input: RpcInput<'find_product_by_barcode'> = storeId ? { p_code: code, p_store_id: storeId } : { p_code: code };
  return qc.fetchQuery({
    queryKey: qk.rpc('find_product_by_barcode', input),
    queryFn: () =>
      rpcCall<'find_product_by_barcode', BarcodeHit>('find_product_by_barcode', input, { output: BarcodeHitSchema }),
    staleTime: 0,
  });
}

export function useRecentPrices() {
  return useQuery({
    queryKey: ['rest', 'price_record_view', 'recent'],
    queryFn: fetchRecentPrices,
    enabled: useSignedIn(),
  });
}

/** Badge Unggahan (§5.5): ikut 5 dtk selama R13 dipolling, selain itu tiap 60 dtk. */
export function useNeedsCheckCount() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['rest', 'capture', 'needs_confirmation_count'],
    queryFn: fetchNeedsCheckCount,
    enabled: useSignedIn(),
    refetchInterval: () => (listPollingActive(qc) ? POLL_MS : BADGE_IDLE_MS),
  });
}
