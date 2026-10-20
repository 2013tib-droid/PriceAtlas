'use client';
// Antrean foto di React (docs/07 §5.4): satu Outbox per user yang masuk, dimulai saat app dibuka
// (pemicu "open"). Daftar item dibaca sebagai query lokal ['local', 'outbox', user] (tidak ikut
// persist TanStack; datanya sudah di IndexedDB).
import type { MyContext } from '@priceatlas/contracts';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { myContextQuery } from '@/lib/auth/context';
import { useAuth } from '@/lib/auth/session';
import { qk } from '@/lib/data/query-keys';
import { createOutbox, type Outbox } from './outbox';
import { findDuplicates, refreshSession, submitCapture, uploadToStorage } from './outbox-deps';
import type { OutboxItem } from './outbox-store';

const OutboxContext = createContext<Outbox | null>(null);

export function useOutboxHandle(): Outbox | null {
  return useContext(OutboxContext);
}

export const outboxQueryKey = (userId: string | null) => ['local', 'outbox', userId] as const;

async function householdIdFrom(qc: QueryClient): Promise<string | null> {
  const cached = qc.getQueryData<MyContext>(qk.rpc('get_my_context'));
  if (cached) return cached.household.id;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  try {
    return (await qc.fetchQuery(myContextQuery)).household.id;
  } catch {
    return null;
  }
}

/** Dependensi Supabase asli. Test komponen menyuntikkan `factory` lain. */
export function defaultOutboxFactory(userId: string, qc: QueryClient): Outbox {
  return createOutbox(userId, {
    upload: uploadToStorage,
    submit: async (input) => {
      const r = await submitCapture(input);
      if (r.ok) void qc.invalidateQueries({ queryKey: ['rpc', 'list_captures'] });
      return r;
    },
    findDuplicates,
    refreshSession,
    householdId: () => householdIdFrom(qc),
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
    now: () => Date.now(),
  });
}

export function OutboxProvider({
  children,
  factory = defaultOutboxFactory,
}: {
  children: ReactNode;
  factory?: (userId: string, qc: QueryClient) => Outbox;
}) {
  const auth = useAuth();
  const qc = useQueryClient();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  const [outbox, setOutbox] = useState<Outbox | null>(null);

  useEffect(() => {
    if (!userId) return;
    const o = factory(userId, qc);
    // Outbox adalah sistem luar (IndexedDB, BroadcastChannel, timer) yang hidup selama user masuk;
    // instance dibuat dan dihentikan di effect yang sama supaya aman di StrictMode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOutbox(o);
    const off = o.subscribe(() => void qc.invalidateQueries({ queryKey: outboxQueryKey(userId) }));
    void o.kick('open');
    return () => {
      off();
      o.stop();
      setOutbox(null);
    };
  }, [userId, qc, factory]);

  return <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>;
}

/** Item antrean lokal (terlama dulu). */
export function useOutboxItems() {
  const outbox = useOutboxHandle();
  const userId = outbox?.userId ?? null;
  const q = useQuery({
    queryKey: outboxQueryKey(userId),
    queryFn: async () => (await outbox!.store.list()).items,
    enabled: Boolean(outbox),
    networkMode: 'always',
    staleTime: Infinity,
  });
  return { outbox, items: (q.data ?? []) as OutboxItem[], ready: q.isSuccess };
}
