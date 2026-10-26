'use client';
// Data M6 (docs/07 §4.3, docs/05 §3.3 S-00c, S-19, S-19b, S-19c, §4.6, §7.6): R21 (useMyPrograms, M3),
// W14 set_share_prices_public, W15 share_existing_prices, W16 set_program_membership, REST PATCH
// `profile.display_name`, REST `barcode_assignment` select + insert produk privat sendiri (D-89), dan
// `POST /api/account/delete` (route server satu-satunya, D-76). Semua RPC/REST dengan JWT user (D-61);
// RLS satu-satunya otorisasi. Setelah W14/W16 konteks R1 diinvalidasi (§4.3).
import {
  SetProgramMembershipResultSchema,
  SetSharePricesPublicResultSchema,
  ShareExistingPricesResultSchema,
  type SetProgramMembershipResult,
  type SetSharePricesPublicResult,
  type ShareExistingPricesResult,
} from '@priceatlas/contracts';
import type { Database } from '@priceatlas/db-types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/session';
import type { BarcodeInsert } from '@/lib/catalog/barcodes';
import { isAlreadyCreated } from '@/lib/confirm/errors';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { fromRpcError, toAppError } from './errors';
import { qk } from './query-keys';
import {
  BARCODE_ROW_COLUMNS,
  BarcodeRowSchema,
  PROFILE_ROW_COLUMNS,
  ProfileRowSchema,
  type BarcodeRow,
  type ProfileRow,
} from './rest-schemas';
import { rpcCall } from './rpc';

const VALIDATE_OUTPUT = process.env.NODE_ENV !== 'production';

function client(): SupabaseClient<Database> {
  return getSupabaseBrowserClient() as unknown as SupabaseClient<Database>;
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

/** Keanggotaan berubah → R1 (program_ids), R21, dan "Dihitung untukmu" S-10/S-11 (D-27). */
function invalidateMembership(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['rpc', 'get_my_context'] }),
    qc.invalidateQueries({ queryKey: ['rpc', 'get_my_programs'] }),
    qc.invalidateQueries({ queryKey: ['rpc', 'get_receipt'] }),
    qc.invalidateQueries({ queryKey: ['rpc', 'get_capture_items'] }),
  ]);
}

// ---------------------------------------------------------------------------
// W16 set_program_membership (S-00c, S-19b)
// ---------------------------------------------------------------------------
export function setMembership(programId: string, member: boolean) {
  return rpcCall<'set_program_membership', SetProgramMembershipResult>(
    'set_program_membership',
    { p_program_id: programId, p_member: member },
    { output: SetProgramMembershipResultSchema },
  );
}

/** S-19b: satu toggle = satu W16. Tanpa optimistic update (toggle menunggu hasil, lalu R21 dimuat ulang). */
export function useToggleMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { programId: string; member: boolean }) => setMembership(a.programId, a.member),
    onSettled: () => invalidateMembership(qc),
  });
}

/** S-00c "Simpan & lanjut": W16 berurutan untuk program terpilih (idempoten, aman diulang). */
export function useJoinPrograms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (programIds: readonly string[]) => {
      for (const id of programIds) await setMembership(id, true);
    },
    onSettled: () => invalidateMembership(qc),
  });
}

// ---------------------------------------------------------------------------
// W14 · W15 berbagi publik (S-19c, docs/05 §4.6)
// ---------------------------------------------------------------------------
export function useSetSharePublic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      rpcCall<'set_share_prices_public', SetSharePricesPublicResult>(
        'set_share_prices_public',
        { p_enabled: enabled },
        { output: SetSharePricesPublicResultSchema },
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rpc', 'get_my_context'] }),
  });
}

export function useShareExisting() {
  return useMutation({
    mutationFn: () =>
      rpcCall<'share_existing_prices', ShareExistingPricesResult>(
        'share_existing_prices',
        {},
        { output: ShareExistingPricesResultSchema },
      ),
  });
}

// ---------------------------------------------------------------------------
// REST profile (S-19: nama tampilan)
// ---------------------------------------------------------------------------
/** `PATCH profile?user_id=eq.X` (RLS self_update). Nama kosong → null. */
export async function patchDisplayName(userId: string, name: string): Promise<ProfileRow> {
  const display_name = name.trim() || null;
  const data = await rest(
    () =>
      client()
        .from('profile')
        .update({ display_name })
        .eq('user_id', userId)
        .select(PROFILE_ROW_COLUMNS) as unknown as PromiseLike<{ data: unknown; error: unknown }>,
  );
  const list = (data ?? []) as ProfileRow[];
  const parsed = VALIDATE_OUTPUT ? ProfileRowSchema.array().parse(list) : list;
  if (!parsed[0]) throw fromRpcError({ message: 'NOT_FOUND' });
  return parsed[0];
}

export function usePatchDisplayName() {
  const qc = useQueryClient();
  const userId = useAuth().user?.id ?? null;
  return useMutation({
    mutationFn: (name: string) => patchDisplayName(userId!, name),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.rpc('get_my_context') }),
  });
}

// ---------------------------------------------------------------------------
// REST barcode_assignment (S-15 edit, D-89 / Q-85)
// ---------------------------------------------------------------------------
export function barcodesKey(productId: string) {
  return ['rest', 'barcode_assignment', productId] as const;
}

export function useBarcodes(productId: string | null) {
  return useQuery({
    queryKey: barcodesKey(productId ?? ''),
    queryFn: async () => {
      const data = await rest(
        () =>
          client()
            .from('barcode_assignment')
            .select(BARCODE_ROW_COLUMNS)
            .eq('product_id', productId!) as unknown as PromiseLike<{ data: unknown; error: unknown }>,
      );
      const list = (data ?? []) as BarcodeRow[];
      return VALIDATE_OUTPUT ? BarcodeRowSchema.array().parse(list) : list;
    },
    enabled: useAuth().status === 'signed-in' && Boolean(productId),
    staleTime: 0,
  });
}

/** Insert dengan id dari klien; 23505 (kiriman ulang) = sudah tersimpan. R6 scan ikut diinvalidasi. */
export function useAddBarcode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: BarcodeInsert) => {
      try {
        await rest(
          () =>
            client().from('barcode_assignment').insert(row) as unknown as PromiseLike<{
              data: unknown;
              error: unknown;
            }>,
        );
      } catch (e) {
        if (!isAlreadyCreated(e)) throw e;
      }
      return row;
    },
    onSettled: (_r, _e, row) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: barcodesKey(row.product_id) }),
        qc.invalidateQueries({ queryKey: ['rpc', 'find_product_by_barcode'] }),
      ]),
  });
}

// ---------------------------------------------------------------------------
// Hapus akun (D-76, docs/05 §7.6): POST /api/account/delete dengan cookie sesi
// ---------------------------------------------------------------------------
export async function requestAccountDeletion(confirm: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch('/api/account/delete', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
