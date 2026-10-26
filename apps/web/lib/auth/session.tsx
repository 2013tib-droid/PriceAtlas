'use client';
// Status sesi di klien (docs/07 §3.5). Sesi dibaca dari cookie lewat supabase-js (tanpa jaringan),
// sehingga shell tetap tahu siapa user saat offline.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { startPersist } from '@/lib/data/query-client';
import { deleteUserData, lockUserDb, unlockUserDb } from '@/lib/offline/db';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

export type SessionUser = { id: string; email: string | null };
export type AuthState =
  { status: 'loading'; user: null } | { status: 'signed-out'; user: null } | { status: 'signed-in'; user: SessionUser };

const AuthContext = createContext<AuthState>({ status: 'loading', user: null });

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });
  const userId = state.user?.id ?? null;

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const apply = (u: { id: string; email?: string | null } | null | undefined) => {
      // Login (lagi): IndexedDB user boleh dibuka (dikunci saat Keluar, F-81).
      if (u) unlockUserDb(u.id);
      setState((prev) => {
        if (!u) return prev.status === 'signed-out' ? prev : { status: 'signed-out', user: null };
        if (prev.user?.id === u.id) return prev;
        return { status: 'signed-in', user: { id: u.id, email: u.email ?? null } };
      });
    };
    void supabase.auth.getSession().then(({ data }) => apply(data.session?.user));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // SIGNED_OUT juga terjadi saat refresh token gagal: cache di memori dibersihkan, tetapi data
      // lokal (antrean foto) hanya dihapus lewat signOutAndClear() yang dipanggil user (Q-61).
      if (event === 'SIGNED_OUT') queryClient.clear();
      apply(session?.user);
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  // Persist cache query per user (IndexedDB priceatlas:<user_id>, §5.3).
  const persistRef = useRef<ReturnType<typeof startPersist> | null>(null);
  useEffect(() => {
    if (!userId) return;
    persistRef.current = startPersist(queryClient, userId);
    const off = onLocalStop(() => {
      persistRef.current?.unsubscribe();
      persistRef.current = null;
    });
    return () => {
      off();
      persistRef.current?.unsubscribe();
      persistRef.current = null;
    };
  }, [queryClient, userId]);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Penulis IndexedDB yang harus berhenti SEBELUM database dihapus (persist TanStack, antrean foto):
// tanpa ini tulisan terakhir mereka bisa membuat ulang `priceatlas:<user_id>` setelah dihapus.
const localStoppers = new Set<() => void>();

/** Daftarkan penghenti penulis data lokal; dipanggil oleh signOutAndClear. Mengembalikan pelepas. */
export function onLocalStop(stop: () => void): () => void {
  localStoppers.add(stop);
  return () => localStoppers.delete(stop);
}

/**
 * Keluar + hapus semua data lokal user (D-81, Q-61, P-13): penulis lokal dihentikan, sesi Auth
 * diakhiri, cache query di memori dibersihkan, lalu IndexedDB user, Cache Storage (shell), dan
 * sessionStorage (draf/pilihan layar) dihapus. Offline: signOut global gagal → sesi lokal tetap
 * dihapus (`scope: 'local'`). Peringatan antrean ditampilkan pemanggil (S-19, Privasi) sebelumnya.
 */
export async function signOutAndClear(userId: string | null, queryClient?: QueryClient): Promise<void> {
  for (const stop of [...localStoppers]) {
    try {
      stop();
    } catch {
      // Penghenti yang gagal tidak boleh menahan keluar.
    }
  }
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.signOut().catch((e: unknown) => ({ error: e }));
  if (error) await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  queryClient?.clear();
  if (userId) {
    lockUserDb(userId);
    await deleteUserData(userId).catch(() => undefined);
  }
  await clearCacheStorage();
  try {
    sessionStorage.clear();
  } catch {
    // sessionStorage tidak tersedia: tidak ada yang perlu dihapus.
  }
}

/**
 * Cache Storage (shell + precache SW, tanpa data user: D-79, P-14) dihapus sesuai Q-61. Precache yang
 * hilang tidak diisi ulang oleh SW yang sama, jadi SW juga dilepas: kunjungan online berikutnya
 * mendaftarkan dan memasang ulang SW (SerwistProvider) beserta precache-nya (F-91).
 */
async function clearCacheStorage(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    // Cache Storage tidak tersedia (mis. konteks tidak aman): tidak ada yang perlu dihapus.
  }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // Tanpa service worker: tidak ada yang perlu dilepas.
  }
}
