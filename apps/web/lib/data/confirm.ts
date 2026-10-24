'use client';
// Data M3 (docs/07 §4.3, docs/05 §3.3 S-10…S-15): R15 get_receipt dan R16 get_capture_items
// (staleTime 0, TIDAK di-persist: NO_PERSIST_RPCS, P-13/P-14), R17 recent_locations, W4/W5/W7/W8/
// W16/W17/W18, REST PATCH receipt (filter updated_at, 0 baris = STALE_WRITE di klien), REST store/
// branch/category. Tanpa optimistic update untuk angka harga: setelah tulis, kunci terkait
// diinvalidasi dan ringkasan dipantau lewat refreshed_at (SummaryUpdating).
import {
  CaptureItemSchema,
  ConfirmCaptureItemsResultSchema,
  ConfirmReceiptResultSchema,
  MyProgramSchema,
  ProductCardSchema,
  ReceiptDetailSchema,
  RecentLocationSchema,
  type CaptureItem,
  type ConfirmCaptureItemsResult,
  type ConfirmReceiptResult,
  type MyProgram,
  type ProductCard,
  type ReceiptDetail,
  type RecentLocation,
  type RpcInput,
} from '@priceatlas/contracts';
import type { Database } from '@priceatlas/db-types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '@/lib/auth/session';
import { isAlreadyCreated } from '@/lib/confirm/errors';
import type { ItemPatch } from '@/lib/confirm/item-patch';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { invalidateCaptures } from './captures';
import { AppError, fromRpcError, toAppError } from './errors';
import { qk } from './query-keys';
import { rpcCall } from './rpc';

function client(): SupabaseClient<Database> {
  return getSupabaseBrowserClient() as unknown as SupabaseClient<Database>;
}

function useSignedIn(): boolean {
  return useAuth().status === 'signed-in';
}

/** Konflik PATCH REST (0 baris berubah) diperlakukan sama dengan STALE_WRITE RPC (§3.4). */
export function staleWriteError(): AppError {
  return new AppError(
    'rpc',
    { code: 'STALE_WRITE', sqlstate: null, http: 409, detail: {}, hint: null, message: 'STALE_WRITE' },
    'STALE_WRITE',
  );
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

// ---------------------------------------------------------------------------
// Invalidasi setelah tulis harga (§4.3: R3/R4/R7–R12 produk terkait, R13/R14)
// ---------------------------------------------------------------------------
const PRODUCT_SCOPED = ['get_product_detail', 'price_history', 'price_chart', 'price_trend', 'where_cheaper'];
const LIST_SCOPED = ['search_products', 'get_product_cards', 'compare_sizes', 'get_offline_cache'];

export function invalidateAfterPriceWrite(qc: QueryClient, productIds: readonly string[]) {
  const ids = new Set(productIds);
  return Promise.all([
    qc.invalidateQueries({
      predicate: (q) => {
        const [scope, name, input] = q.queryKey as [string, string, Record<string, unknown> | undefined];
        if (scope !== 'rpc') return false;
        if (LIST_SCOPED.includes(name)) return true;
        if (!PRODUCT_SCOPED.includes(name)) return false;
        // where_cheaper per group: ikut diinvalidasi (produk group tidak diketahui di sini).
        return ids.size === 0 || !input?.p_product_id || ids.has(String(input.p_product_id));
      },
    }),
    qc.invalidateQueries({ queryKey: ['rest', 'price_record_view'] }),
    invalidateCaptures(qc),
  ]);
}

// ---------------------------------------------------------------------------
// R15 get_receipt · W4 confirm_receipt · REST PATCH receipt · W7 correct_receipt_line
// ---------------------------------------------------------------------------
export function receiptKey(id: string) {
  return qk.rpc('get_receipt', { p_receipt_id: id });
}

export function useReceipt(id: string | null) {
  const input: RpcInput<'get_receipt'> = { p_receipt_id: id ?? '' };
  return useQuery({
    queryKey: qk.rpc('get_receipt', input),
    queryFn: () => rpcCall<'get_receipt', ReceiptDetail>('get_receipt', input, { output: ReceiptDetailSchema }),
    enabled: useSignedIn() && Boolean(id),
  });
}

export function useConfirmReceipt() {
  return useMutation({
    mutationFn: (input: RpcInput<'confirm_receipt'>) =>
      rpcCall<'confirm_receipt', ConfirmReceiptResult>('confirm_receipt', input, {
        output: ConfirmReceiptResultSchema,
      }),
  });
}

/** Kolom header yang boleh di-PATCH (docs/05 §3.3 S-10, D-64). */
export type ReceiptHeaderPatch = Partial<
  Pick<
    Database['public']['Tables']['receipt']['Update'],
    | 'store_id'
    | 'branch_id'
    | 'transaction_date'
    | 'transaction_time'
    | 'total_amount'
    | 'subtotal_amount'
    | 'payment_method'
  >
>;

/** `PATCH receipt?id=eq.X&updated_at=eq.T` + `Prefer: return=representation`. 0 baris → STALE_WRITE. */
export async function patchReceiptHeader(id: string, updatedAt: string, patch: ReceiptHeaderPatch) {
  const rows = await rest(() =>
    client().from('receipt').update(patch).eq('id', id).eq('updated_at', updatedAt).select('id,updated_at'),
  );
  if (!rows || rows.length === 0) throw staleWriteError();
  return rows[0]!;
}

export function usePatchReceiptHeader(receiptId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { updatedAt: string; patch: ReceiptHeaderPatch }) =>
      patchReceiptHeader(receiptId!, a.updatedAt, a.patch),
    onSettled: () => qc.invalidateQueries({ queryKey: receiptKey(receiptId ?? '') }),
  });
}

export function useCorrectReceiptLine(receiptId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RpcInput<'correct_receipt_line'>) => rpcCall('correct_receipt_line', input),
    onSettled: () => qc.invalidateQueries({ queryKey: receiptKey(receiptId ?? '') }),
  });
}

// ---------------------------------------------------------------------------
// R16 get_capture_items · W18 update_capture_item · W5 confirm_capture_items
// ---------------------------------------------------------------------------
export function itemsKey(captureId: string) {
  return qk.rpc('get_capture_items', { p_capture_id: captureId });
}

export function fetchCaptureItems(captureId: string) {
  return rpcCall<'get_capture_items', CaptureItem[]>(
    'get_capture_items',
    { p_capture_id: captureId },
    { output: z.array(CaptureItemSchema) },
  );
}

export function useCaptureItems(captureId: string | null) {
  return useQuery({
    queryKey: itemsKey(captureId ?? ''),
    queryFn: () => fetchCaptureItems(captureId!),
    enabled: useSignedIn() && Boolean(captureId),
  });
}

export function updateCaptureItem(itemId: string, patch: ItemPatch, expectedUpdatedAt: string) {
  return rpcCall<'update_capture_item', CaptureItem>(
    'update_capture_item',
    { p_item_id: itemId, p_patch: patch, p_expected_updated_at: expectedUpdatedAt },
    { output: CaptureItemSchema },
  );
}

/** Ganti satu item di cache R16 dengan versi server (hasil W18). */
export function putCaptureItem(qc: QueryClient, item: CaptureItem) {
  qc.setQueryData<CaptureItem[]>(itemsKey(item.capture_id), (list) =>
    list ? list.map((i) => (i.id === item.id ? item : i)) : list,
  );
}

export function useConfirmCaptureItems() {
  return useMutation({
    mutationFn: (input: RpcInput<'confirm_capture_items'>) =>
      rpcCall<'confirm_capture_items', ConfirmCaptureItemsResult>('confirm_capture_items', input, {
        output: ConfirmCaptureItemsResultSchema,
      }),
  });
}

// ---------------------------------------------------------------------------
// W16 set_program_membership (U-21 di S-10, "Saya member" di S-11)
// ---------------------------------------------------------------------------
export function useSetMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (programId: string) => rpcCall('set_program_membership', { p_program_id: programId, p_member: true }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['rpc', 'get_my_context'] }),
        qc.invalidateQueries({ queryKey: ['rpc', 'get_my_programs'] }),
        qc.invalidateQueries({ queryKey: ['rpc', 'get_receipt'] }),
        qc.invalidateQueries({ queryKey: ['rpc', 'get_capture_items'] }),
      ]),
  });
}

/** R21: nama program member untuk harga member di S-11. */
export function useMyPrograms() {
  return useQuery({
    queryKey: qk.rpc('get_my_programs'),
    queryFn: () => rpcCall<'get_my_programs', MyProgram[]>('get_my_programs', {}, { output: z.array(MyProgramSchema) }),
    enabled: useSignedIn(),
  });
}

// ---------------------------------------------------------------------------
// S-12: R17, REST store/branch, W17
// ---------------------------------------------------------------------------
export function useRecentLocations() {
  const input: RpcInput<'recent_locations'> = { p_limit: 10 };
  return useQuery({
    queryKey: qk.rpc('recent_locations', input),
    queryFn: () =>
      rpcCall<'recent_locations', RecentLocation[]>('recent_locations', input, {
        output: z.array(RecentLocationSchema),
      }),
    enabled: useSignedIn(),
  });
}

export type StoreRow = { id: string; name: string; channel: 'offline' | 'online'; household_id: string | null };
export type BranchRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  kind: 'physical' | 'seller';
  status: 'open' | 'closed';
  household_id: string | null;
  store_id: string;
};

/** Sama dengan app.normalize_text untuk filter `normalized_name` (huruf kecil, tanpa diakritik, spasi tunggal). */
export function normalizeName(q: string): string {
  return q
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[%_*(),."]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const STORE_LIST_LIMIT = 50;

/** `store?select=id,name,channel,household_id&status=eq.active&normalized_name=ilike.*q*&order=name` */
export function useStores(q: string, enabled = true) {
  const term = normalizeName(q);
  return useQuery({
    queryKey: ['rest', 'store', term],
    queryFn: () =>
      rest<StoreRow[]>(() => {
        let req = client()
          .from('store')
          .select('id,name,channel,household_id')
          .eq('status', 'active')
          .order('name')
          .limit(STORE_LIST_LIMIT);
        if (term) req = req.ilike('normalized_name', `*${term}*`);
        return req as unknown as PromiseLike<{ data: StoreRow[] | null; error: unknown }>;
      }),
    enabled: useSignedIn() && enabled,
    placeholderData: (prev) => prev,
  });
}

/** `branch?store_id=eq.X&order=status,name` (cabang tutup di bawah). */
export function useBranches(storeId: string | null) {
  return useQuery({
    queryKey: ['rest', 'branch', storeId],
    queryFn: () =>
      rest<BranchRow[]>(
        () =>
          client()
            .from('branch')
            .select('id,name,city,region,kind,status,household_id,store_id')
            .eq('store_id', storeId!)
            .order('status')
            .order('name') as unknown as PromiseLike<{ data: BranchRow[] | null; error: unknown }>,
      ),
    enabled: useSignedIn() && Boolean(storeId),
  });
}

/** Nama toko/cabang untuk id di R16 (yang hanya memuat id). REST `store/branch?id=in.(…)`. */
export function useLocationNames(storeIds: readonly string[], branchIds: readonly string[]) {
  const s = [...new Set(storeIds)].sort();
  const b = [...new Set(branchIds)].sort();
  const signedIn = useSignedIn();
  const stores = useQuery({
    queryKey: ['rest', 'store', 'by-id', s],
    queryFn: () =>
      rest<StoreRow[]>(
        () =>
          client().from('store').select('id,name,channel,household_id').in('id', s) as unknown as PromiseLike<{
            data: StoreRow[] | null;
            error: unknown;
          }>,
      ),
    enabled: signedIn && s.length > 0,
  });
  const branches = useQuery({
    queryKey: ['rest', 'branch', 'by-id', b],
    queryFn: () =>
      rest<BranchRow[]>(
        () =>
          client()
            .from('branch')
            .select('id,name,city,region,kind,status,household_id,store_id')
            .in('id', b) as unknown as PromiseLike<{ data: BranchRow[] | null; error: unknown }>,
      ),
    enabled: signedIn && b.length > 0,
  });
  return {
    store: (id: string | null | undefined) => (id ? stores.data?.find((x) => x.id === id) : undefined),
    branch: (id: string | null | undefined) => (id ? branches.data?.find((x) => x.id === id) : undefined),
  };
}

type StoreJson = { id: string; name: string; channel: 'offline' | 'online'; is_private: boolean };
type BranchJson = { id: string; name: string; status: 'open' | 'closed'; kind: string; is_private: boolean };

/** W17 dengan id dari klien; 23505 = sudah tersimpan = sukses (idempoten). */
export function useCreateStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RpcInput<'create_private_store'>['p_store'] & { id: string }) => {
      try {
        return await rpcCall<'create_private_store', StoreJson>('create_private_store', { p_store: input });
      } catch (e) {
        if (isAlreadyCreated(e))
          return { id: input.id, name: input.name, channel: input.channel ?? 'offline', is_private: true };
        throw e;
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['rest', 'store'] }),
  });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RpcInput<'create_private_branch'>['p_branch'] & { id: string }) => {
      try {
        return await rpcCall<'create_private_branch', BranchJson>('create_private_branch', { p_branch: input });
      } catch (e) {
        if (isAlreadyCreated(e))
          return {
            id: input.id,
            name: input.name,
            status: 'open' as const,
            kind: input.kind ?? 'physical',
            is_private: true,
          };
        throw e;
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['rest', 'branch'] }),
  });
}

// ---------------------------------------------------------------------------
// S-15: W8 create_private_product, kategori/brand/group (REST baca, RLS)
// ---------------------------------------------------------------------------
export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: RpcInput<'create_private_product'>['p_product'] & { id: string }) => {
      try {
        return await rpcCall<'create_private_product', ProductCard>(
          'create_private_product',
          { p_product: p },
          { output: ProductCardSchema },
        );
      } catch (e) {
        if (!isAlreadyCreated(e)) throw e;
        const cards = await rpcCall<'get_product_cards', ProductCard[]>('get_product_cards', { p_ids: [p.id] });
        if (!cards[0]) throw e;
        return cards[0];
      }
    },
    onSuccess: (card) => invalidateAfterPriceWrite(qc, [card.product.id]),
  });
}

export type CategoryRow = { id: string; name: string; household_id: string | null };

/** Kategori sistem + milik sendiri (§5.8). REST baca (RLS); lihat F-53/Q-77. */
export function useCategories() {
  return useQuery({
    queryKey: ['rest', 'category'],
    queryFn: () =>
      rest<CategoryRow[]>(
        () =>
          client()
            .from('category')
            .select('id,name,household_id')
            .is('archived_at', null)
            .order('name') as unknown as PromiseLike<{ data: CategoryRow[] | null; error: unknown }>,
      ),
    enabled: useSignedIn(),
    staleTime: 60 * 60_000,
  });
}

export type NamedRow = { id: string; name: string; household_id: string | null };

/** Brand / group untuk saran di S-15 (REST baca, RLS). */
export function useNamedSearch(table: 'brand' | 'product_group', q: string) {
  const term = normalizeName(q);
  return useQuery({
    queryKey: ['rest', table, term],
    queryFn: () =>
      rest<NamedRow[]>(() => {
        let req = client().from(table).select('id,name,household_id').eq('status', 'active').order('name').limit(20);
        if (term) req = req.ilike('normalized_name', `*${term}*`);
        return req as unknown as PromiseLike<{ data: NamedRow[] | null; error: unknown }>;
      }),
    enabled: useSignedIn(),
    placeholderData: (prev) => prev,
  });
}
