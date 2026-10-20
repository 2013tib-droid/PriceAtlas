'use client';
// Status sesi di klien (docs/07 §3.5). Sesi dibaca dari cookie lewat supabase-js (tanpa jaringan),
// sehingga shell tetap tahu siapa user saat offline.
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { startPersist } from '@/lib/data/query-client';
import { deleteUserData } from '@/lib/offline/db';
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
    const apply = (u: { id: string; email?: string | null } | null | undefined) =>
      setState((prev) => {
        if (!u) return prev.status === 'signed-out' ? prev : { status: 'signed-out', user: null };
        if (prev.user?.id === u.id) return prev;
        return { status: 'signed-in', user: { id: u.id, email: u.email ?? null } };
      });
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
    return () => {
      persistRef.current?.unsubscribe();
      persistRef.current = null;
    };
  }, [queryClient, userId]);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Keluar + hapus semua data lokal user (D-81, Q-61). Peringatan antrean ditambahkan di M6. */
export async function signOutAndClear(userId: string | null): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  await supabase.auth.signOut();
  if (userId) await deleteUserData(userId).catch(() => undefined);
}
