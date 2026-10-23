'use client';
// Data sesi belanja (docs/07 §4.3, docs/05 §3.3 S-12/S-13): R18 get_active_session (staleTime
// 30 dtk, di-persist sehingga banner/S-13 tetap tampil offline; polling 5 dtk hanya saat ada label
// uploaded/processing dan tab terlihat, P-15), W11 start (id dari klien, mengulang id = sesi sama,
// F-16), W12 perpanjang (+session_extend_hours), W13 akhiri (idempoten). Diinvalidasi setelah
// W11/W12/W13, setelah W1 label (antrean), dan bersama R13 (invalidateCaptures).
import {
  ActiveSessionSchema,
  EndedSessionSchema,
  SessionTimesSchema,
  type ActiveSession,
  type EndedSession,
  type SessionTimes,
} from '@priceatlas/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/session';
import { activeOrNull, sessionPollInterval } from '@/lib/session/session';
import { qk } from './query-keys';
import { rpcCall } from './rpc';

export const sessionKey = () => qk.rpc('get_active_session');

export function fetchActiveSession(): Promise<ActiveSession | null> {
  return rpcCall<'get_active_session', ActiveSession | null>('get_active_session', {}, { output: ActiveSessionSchema });
}

/**
 * R18. `refetchOnMount: 'always'` hanya untuk S-13 (layar sesi selalu menampilkan status terbaru saat
 * dibuka); banner dan layar lain memakai staleTime 30 dtk.
 */
export function useActiveSession(opts: { refetchOnMount?: 'always' } = {}) {
  return useQuery({
    queryKey: sessionKey(),
    queryFn: fetchActiveSession,
    enabled: useAuth().status === 'signed-in',
    refetchInterval: (q) => sessionPollInterval(q.state.data),
    ...opts,
  });
}

/** Sesi di cache saat ini (mis. saat shutter ditekan, P-11). */
export function cachedSession(qc: QueryClient): ActiveSession | null {
  return qc.getQueryData<ActiveSession | null>(sessionKey()) ?? null;
}

/** Sesi aktif menurut cache dan jam saat ini (D-43: sesi yang lewat `expires_at` tidak dipakai). */
export function activeSessionNow(qc: QueryClient): ActiveSession | null {
  return activeOrNull(cachedSession(qc), Date.now());
}

export function invalidateSession(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ['rpc', 'get_active_session'] });
}

/** W11: hasil = R18 (null jika id ini milik sesi yang sudah berakhir). */
export function useStartSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { sessionId: string; branchId: string }) =>
      rpcCall<'start_shopping_session', ActiveSession | null>(
        'start_shopping_session',
        { p_session_id: v.sessionId, p_branch_id: v.branchId },
        { output: ActiveSessionSchema },
      ),
    onSuccess: (data) => {
      if (data) qc.setQueryData(sessionKey(), data);
    },
    onSettled: () =>
      Promise.all([invalidateSession(qc), qc.invalidateQueries({ queryKey: ['rpc', 'recent_locations'] })]),
  });
}

/** W12: `expires_at + session_extend_hours` (D-60, W-20). */
export function useExtendSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      rpcCall<'extend_shopping_session', SessionTimes>(
        'extend_shopping_session',
        { p_session_id: sessionId },
        { output: SessionTimesSchema },
      ),
    onSuccess: (times) =>
      qc.setQueryData<ActiveSession | null>(sessionKey(), (prev) =>
        prev && prev.session.id === times.id ? { ...prev, session: { ...prev.session, ...times } } : prev,
      ),
    onSettled: () => invalidateSession(qc),
  });
}

/** W13: idempoten (sesi yang sudah berakhir → sukses). */
export function useEndSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      rpcCall<'end_shopping_session', EndedSession>(
        'end_shopping_session',
        { p_session_id: sessionId },
        { output: EndedSessionSchema },
      ),
    onSuccess: (s) =>
      qc.setQueryData<ActiveSession | null>(sessionKey(), (prev) => (prev && prev.session.id === s.id ? null : prev)),
    onSettled: () => invalidateSession(qc),
  });
}
