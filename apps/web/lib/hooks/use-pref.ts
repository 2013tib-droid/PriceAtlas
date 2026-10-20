'use client';
// Preferensi perangkat sebagai query lokal (['local', 'prefs', user, key]); tidak ikut persist
// TanStack (sudah di IndexedDB `prefs`).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAuth } from '@/lib/auth/session';
import { readPref, writePref, type PrefKey } from '@/lib/offline/prefs';

export function usePref<T>(key: PrefKey, fallback: T) {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const qc = useQueryClient();
  const queryKey = ['local', 'prefs', userId, key] as const;
  const q = useQuery({
    queryKey,
    queryFn: () => readPref<T>(userId!, key, fallback),
    enabled: Boolean(userId),
    staleTime: Infinity,
    networkMode: 'always',
  });

  const update = useCallback(
    async (fn: (prev: T) => T) => {
      if (!userId) return;
      const k = ['local', 'prefs', userId, key];
      const prev = qc.getQueryData<T>(k) ?? (await readPref<T>(userId, key, fallback));
      const next = fn(prev);
      qc.setQueryData(k, next);
      await writePref(userId, key, next);
    },
    // fallback sengaja tidak masuk dependensi: nilai awal saja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, userId, key],
  );

  return { value: q.data ?? fallback, ready: q.isSuccess, update };
}
