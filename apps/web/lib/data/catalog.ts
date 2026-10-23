'use client';
// Data M5 (docs/07 §4.3, docs/05 §3.3 S-15…S-18): R19 merge_product_preview, R20 price_record_detail
// (staleTime 0, TIDAK di-persist: NO_PERSIST_RPCS, P-13/P-14), W6 correct_price_record, W7 (lewat
// useCorrectReceiptLine M3), W8 (useCreateProduct M3), W9 move_price_records, W10 merge_product, REST
// `product` (baca baris produk privat sendiri + PATCH dengan filter updated_at; 0 baris = STALE_WRITE).
// Semua tulis dengan JWT user (D-61). Tanpa optimistic update angka harga: setelah tulis, kunci produk
// sumber DAN tujuan diinvalidasi (invalidateAfterPriceWrite) dan ringkasan dipantau (SummaryUpdating).
import {
  MergePreviewSchema,
  MovePriceRecordsResultSchema,
  PriceRecordDetailSchema,
  PriceRecordFullSchema,
  type MergePreview,
  type MovePriceRecordsResult,
  type PriceRecordDetail,
  type PriceRecordFull,
  type RpcInput,
} from '@priceatlas/contracts';
import type { Database } from '@priceatlas/db-types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/session';
import type { ProductPatch } from '@/lib/catalog/product-edit';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { invalidateAfterPriceWrite, staleWriteError } from './confirm';
import { fromRpcError, toAppError } from './errors';
import { qk } from './query-keys';
import { PRODUCT_ROW_COLUMNS, ProductRowSchema, type ProductRow } from './rest-schemas';
import { rpcCall } from './rpc';

const VALIDATE_OUTPUT = process.env.NODE_ENV !== 'production';

function client(): SupabaseClient<Database> {
  return getSupabaseBrowserClient() as unknown as SupabaseClient<Database>;
}

function useSignedIn(): boolean {
  return useAuth().status === 'signed-in';
}

async function rest<T>(run: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  let res;
  try {
    res = await run();
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) throw fromRpcError(res.error as { message: string });
  return res.data as T;
}

function rows(data: unknown): ProductRow[] {
  const list = (data ?? []) as ProductRow[];
  return VALIDATE_OUTPUT ? ProductRowSchema.array().parse(list) : list;
}

// ---------------------------------------------------------------------------
// R20 price_record_detail · W6 correct_price_record (S-16)
// ---------------------------------------------------------------------------
export function recordKey(id: string) {
  return qk.rpc('price_record_detail', { p_id: id });
}

export function fetchRecordDetail(id: string) {
  return rpcCall<'price_record_detail', PriceRecordDetail>(
    'price_record_detail',
    { p_id: id },
    { output: PriceRecordDetailSchema },
  );
}

export function useRecordDetail(id: string | null) {
  return useQuery({
    queryKey: recordKey(id ?? ''),
    queryFn: () => fetchRecordDetail(id!),
    enabled: useSignedIn() && Boolean(id),
  });
}

export function useCorrectRecord() {
  return useMutation({
    mutationFn: (input: RpcInput<'correct_price_record'>) =>
      rpcCall<'correct_price_record', PriceRecordFull>('correct_price_record', input, {
        output: PriceRecordFullSchema,
      }),
  });
}

// ---------------------------------------------------------------------------
// R19 merge_product_preview · W10 merge_product (S-17)
// ---------------------------------------------------------------------------
export function useMergePreview(from: string | null, into: string | null) {
  const input: RpcInput<'merge_product_preview'> = { p_from: from ?? '', p_into: into ?? '' };
  return useQuery({
    queryKey: qk.rpc('merge_product_preview', input),
    queryFn: () =>
      rpcCall<'merge_product_preview', MergePreview>('merge_product_preview', input, { output: MergePreviewSchema }),
    enabled: useSignedIn() && Boolean(from && into),
    staleTime: 0,
  });
}

/** W10 (`returns void`). Hasil diabaikan; keadaan akhir dibaca dari R19/R7. */
export function useMergeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RpcInput<'merge_product'>) => {
      await rpcCall('merge_product', input);
      return input;
    },
    onSuccess: (input) => invalidateAfterPriceWrite(qc, [input.p_from, input.p_into]),
  });
}

// ---------------------------------------------------------------------------
// W9 move_price_records (S-18, T2)
// ---------------------------------------------------------------------------
export function useMoveRecords(sourceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RpcInput<'move_price_records'>) =>
      rpcCall<'move_price_records', MovePriceRecordsResult>('move_price_records', input, {
        output: MovePriceRecordsResultSchema,
      }),
    onSuccess: (res) => invalidateAfterPriceWrite(qc, [...(sourceId ? [sourceId] : []), res.target_product_id]),
  });
}

// ---------------------------------------------------------------------------
// REST product (S-15 edit, arsip, S-17 "Pindahkan ke group")
// ---------------------------------------------------------------------------
export function productRowKey(id: string) {
  return ['rest', 'product', id] as const;
}

/** `product?id=eq.X&select=…` (RLS: global + privat sendiri). Tidak ada = null. */
export async function fetchProductRow(id: string): Promise<ProductRow | null> {
  const data = await rest(
    () =>
      client().from('product').select(PRODUCT_ROW_COLUMNS).eq('id', id) as unknown as PromiseLike<{
        data: unknown;
        error: unknown;
      }>,
  );
  return rows(data)[0] ?? null;
}

export function useProductRow(id: string | null) {
  return useQuery({
    queryKey: productRowKey(id ?? ''),
    queryFn: () => fetchProductRow(id!),
    enabled: useSignedIn() && Boolean(id),
    staleTime: 0,
  });
}

/** `PATCH product?id=eq.X&updated_at=eq.T` + `Prefer: return=representation`. 0 baris → STALE_WRITE. */
export async function patchProduct(id: string, updatedAt: string, patch: ProductPatch): Promise<ProductRow> {
  const data = await rest(
    () =>
      client()
        .from('product')
        .update(patch)
        .eq('id', id)
        .eq('updated_at', updatedAt)
        .select(PRODUCT_ROW_COLUMNS) as unknown as PromiseLike<{ data: unknown; error: unknown }>,
  );
  const list = rows(data);
  if (list.length === 0) throw staleWriteError();
  return list[0]!;
}

/**
 * PATCH produk + invalidasi (ukuran berubah → harga per satuan dihitung ulang job; ringkasan menyusul).
 * `alsoInvalidate`: produk lain yang ikut berubah tampilannya (mis. tujuan "Pindahkan ke group").
 */
export function usePatchProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string; updatedAt: string; patch: ProductPatch; alsoInvalidate?: string[] }) =>
      patchProduct(a.id, a.updatedAt, a.patch),
    onSuccess: (row, a) => {
      qc.setQueryData(productRowKey(row.id), row);
      return invalidateAfterPriceWrite(qc, [row.id, ...(a.alsoInvalidate ?? [])]);
    },
  });
}

/** Saran brand/group untuk S-15 edit: REST baca (D-87), termasuk nilai sekarang (by id). */
export function useNamedById(table: 'brand' | 'product_group', ids: readonly string[]) {
  const list = [...new Set(ids.filter(Boolean))].sort();
  return useQuery({
    queryKey: ['rest', table, 'by-id', list],
    queryFn: () =>
      rest<{ id: string; name: string; household_id: string | null }[]>(
        () =>
          client().from(table).select('id,name,household_id').in('id', list) as unknown as PromiseLike<{
            data: { id: string; name: string; household_id: string | null }[] | null;
            error: unknown;
          }>,
      ),
    enabled: useSignedIn() && list.length > 0,
  });
}
