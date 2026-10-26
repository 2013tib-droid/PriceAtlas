'use client';
// R5 get_offline_cache (D-60, docs/07 §5.6). Kunci query qk.rpc('get_offline_cache'): data query
// hanya {count, synced_at} (di-persist, sehingga staleTime 6 jam berlaku antar-buka app); kartunya
// sendiri di store `offline_cards`. Pemicu sinkron: setelah login (belum ada data), saat app dibuka
// jika sinkron terakhir > 6 jam (staleTime), dan setelah tulis harga (invalidateAfterPriceWrite
// menginvalidasi get_offline_cache). `p_viewed_ids` = "pernah dibuka" dari prefs (cap 150).
import { ProductCardSchema, type ProductCard, type RpcInput } from '@priceatlas/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useAuth } from '@/lib/auth/session';
import {
  matchOfflineCards,
  OFFLINE_TOP,
  readOfflineCards,
  readOfflineCardsByIds,
  replaceOfflineCards,
} from '@/lib/offline/offline-cards';
import { PREF_KEYS, readPref, VIEWED_MAX } from '@/lib/offline/prefs';
import { normalizeQuery, MIN_QUERY } from './queries';
import { whenRestored } from './query-client';
import { qk } from './query-keys';
import { rpcCall } from './rpc';

export type OfflineSync = { count: number; synced_at: number };

/** Kunci query lokal kartu offline (scope 'local': tidak ikut persist TanStack). */
export const offlineCardsKey = (userId: string | null) => ['local', 'offline_cards', userId] as const;

export async function syncOfflineCards(userId: string): Promise<OfflineSync> {
  const viewed = await readPref<string[]>(userId, PREF_KEYS.viewed, []);
  const input: RpcInput<'get_offline_cache'> = { p_viewed_ids: viewed.slice(0, VIEWED_MAX), p_top: OFFLINE_TOP };
  const cards = await rpcCall<'get_offline_cache', ProductCard[]>('get_offline_cache', input, {
    output: z.array(ProductCardSchema),
  });
  const synced_at = Date.now();
  await replaceOfflineCards(userId, cards, synced_at);
  return { count: cards.length, synced_at };
}

/** Dipasang sekali di layout (app). Tidak menampilkan apa pun. */
export function OfflineCacheSync() {
  const auth = useAuth();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  const qc = useQueryClient();
  // Tunggu cache persist dipulihkan: tanpa ini query dimulai sebelum `synced_at` terakhir terbaca
  // dan R5 dipanggil di setiap buka app, bukan hanya jika > 6 jam.
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void whenRestored(userId).then(() => live && setRestoredFor(userId));
    return () => {
      live = false;
    };
  }, [userId]);
  useQuery({
    queryKey: qk.rpc('get_offline_cache'),
    queryFn: async () => {
      const r = await syncOfflineCards(userId!);
      await qc.invalidateQueries({ queryKey: offlineCardsKey(userId) });
      return r;
    },
    enabled: Boolean(userId) && restoredFor === userId,
    // Satu kali gagal (mis. offline) tidak perlu diulang cepat: dicoba lagi saat online/fokus.
    retry: false,
  });
  return null;
}

/** S-02 offline: cari di kartu tersimpan (§5.6). `stored` = jumlah kartu tersimpan (0 = belum sinkron). */
export function useOfflineSearch(query: string, enabled: boolean) {
  const auth = useAuth();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  const q = normalizeQuery(query);
  return useQuery({
    queryKey: [...offlineCardsKey(userId), 'search', q],
    queryFn: async () => {
      const cards = await readOfflineCards(userId!);
      return { results: matchOfflineCards(cards, q), stored: cards.length };
    },
    enabled: enabled && Boolean(userId) && q.length >= MIN_QUERY,
    networkMode: 'always',
    staleTime: 0,
  });
}

/** S-01 "Baru dicek" dan S-03 offline: kartu tersimpan per id. */
export function useOfflineCardsByIds(ids: readonly string[], enabled: boolean) {
  const auth = useAuth();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  return useQuery({
    queryKey: [...offlineCardsKey(userId), 'ids', [...ids]],
    queryFn: () => readOfflineCardsByIds(userId!, ids),
    enabled: enabled && Boolean(userId) && ids.length > 0,
    networkMode: 'always',
    staleTime: 0,
  });
}
