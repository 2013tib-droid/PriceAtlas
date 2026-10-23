'use client';
// Data S-08/S-09 (docs/07 §4.3, §5.5, D-61): R13 list_captures dan R14 get_capture dengan
// staleTime 0 + polling 5 dtk hanya jika ada capture uploaded/processing dan tab terlihat (P-15);
// W2 retry_capture, W3 delete_capture; signed URL 300 dtk (tidak di-persist, tidak di-cache SW, P-14).
import {
  CaptureDetailSchema,
  CaptureListItemSchema,
  type CaptureDetail,
  type CaptureListItem,
  type RpcInput,
} from '@priceatlas/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '@/lib/auth/session';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { qk } from './query-keys';
import { rpcCall } from './rpc';

export const POLL_MS = 5_000;
export const BADGE_IDLE_MS = 60_000;
export const CAPTURE_LIST_LIMIT = 50;
export const SIGNED_URL_SECONDS = 300;

export type CaptureKind = CaptureListItem['kind'];
export type CaptureStatus = CaptureListItem['status'];

export const isActiveStatus = (s: CaptureStatus) => s === 'uploaded' || s === 'processing';

function tabVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** Interval polling R13/R14: 5 dtk jika ada yang aktif dan tab terlihat, selain itu tanpa polling. */
export function pollInterval(statuses: readonly CaptureStatus[] | undefined): number | false {
  return statuses?.some(isActiveStatus) && tabVisible() ? POLL_MS : false;
}

export function captureListInput(kind: CaptureKind | null): RpcInput<'list_captures'> {
  return { p_limit: CAPTURE_LIST_LIMIT, p_kind: kind };
}

export function useCaptures(kind: CaptureKind | null = null) {
  const input = captureListInput(kind);
  return useQuery({
    queryKey: qk.rpc('list_captures', input),
    queryFn: () =>
      rpcCall<'list_captures', CaptureListItem[]>('list_captures', input, {
        output: z.array(CaptureListItemSchema),
      }),
    enabled: useAuth().status === 'signed-in',
    refetchInterval: (q) => pollInterval(q.state.data?.map((c) => c.status)),
  });
}

export function useCapture(id: string | null) {
  const input: RpcInput<'get_capture'> = { p_capture_id: id ?? '' };
  return useQuery({
    queryKey: qk.rpc('get_capture', input),
    queryFn: () => rpcCall<'get_capture', CaptureDetail>('get_capture', input, { output: CaptureDetailSchema }),
    enabled: useAuth().status === 'signed-in' && Boolean(id),
    refetchInterval: (q) => pollInterval(q.state.data ? [q.state.data.capture.status] : undefined),
  });
}

/** Ada daftar R13 di cache yang sedang dipolling? (badge ikut 5 dtk, §5.5). */
export function listPollingActive(qc: QueryClient): boolean {
  return qc
    .getQueriesData<CaptureListItem[]>({ queryKey: ['rpc', 'list_captures'] })
    .some(([, data]) => pollInterval(data?.map((c) => c.status)) !== false);
}

/** Cari baris R13 di cache (jumlah "perlu dicek" untuk S-09, yang tidak ada di R14). */
export function findListedCapture(qc: QueryClient, id: string): CaptureListItem | undefined {
  for (const [, data] of qc.getQueriesData<CaptureListItem[]>({ queryKey: ['rpc', 'list_captures'] })) {
    const hit = data?.find((c) => c.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function invalidateCaptures(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['rpc', 'list_captures'] }),
    qc.invalidateQueries({ queryKey: ['rpc', 'get_capture'] }),
    qc.invalidateQueries({ queryKey: ['rest', 'capture'] }),
    // Status label di S-13/banner ikut berubah (W2/W3/W4/W5).
    qc.invalidateQueries({ queryKey: ['rpc', 'get_active_session'] }),
  ]);
}

export function useRetryCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpcCall('retry_capture', { p_capture_id: id }),
    onSettled: () => invalidateCaptures(qc),
  });
}

export function useDeleteCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpcCall('delete_capture', { p_capture_id: id }),
    onSettled: () => invalidateCaptures(qc),
  });
}

/** Signed URL 300 dtk dengan JWT user. Kunci ['storage', …] tidak pernah di-persist (§4.3). */
export function useSignedUrl(path: string | null) {
  const signedIn = useAuth().status === 'signed-in';
  return useQuery({
    queryKey: ['storage', 'signed', path],
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowserClient()
        .storage.from('captures')
        .createSignedUrl(path!, SIGNED_URL_SECONDS);
      if (error || !data) throw error ?? new Error('signed url');
      return data.signedUrl;
    },
    enabled: Boolean(path) && signedIn,
    staleTime: (SIGNED_URL_SECONDS - 60) * 1000,
    gcTime: SIGNED_URL_SECONDS * 1000,
    retry: false,
  });
}
