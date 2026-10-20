// Preferensi di perangkat (store `prefs`, docs/07 §5.3; 💾 wireframe §8.3): pencarian terakhir,
// produk baru dicek (dipakai juga untuk R5 `p_viewed_ids`, cap 150), toggle tampilan.
import { openUserDb } from './db';

export const PREF_KEYS = {
  recentSearches: 'recent_searches',
  viewed: 'viewed_products',
  chartNormalOnly: 'chart_normal_only',
} as const;
export type PrefKey = (typeof PREF_KEYS)[keyof typeof PREF_KEYS];

export const RECENT_SEARCHES_MAX = 8;
export const VIEWED_MAX = 150;

export async function readPref<T>(userId: string, key: PrefKey, fallback: T): Promise<T> {
  try {
    const db = await openUserDb(userId);
    return ((await db.get('prefs', key)) as T | undefined) ?? fallback;
  } catch {
    // IndexedDB tidak tersedia (mode privat lama): preferensi hanya hilang, layar tetap jalan.
    return fallback;
  }
}

export async function writePref<T>(userId: string, key: PrefKey, value: T): Promise<void> {
  try {
    const db = await openUserDb(userId);
    await db.put('prefs', value, key);
  } catch {
    // Lihat readPref.
  }
}

/** Pencarian terbaru di depan, tanpa duplikat (tidak peka huruf besar), maks 8. */
export function pushRecentSearch(list: readonly string[], query: string): string[] {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < 2) return [...list];
  return [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_SEARCHES_MAX);
}

/** Produk terakhir dibuka di depan, tanpa duplikat, maks 150 (D-60, §5.6). */
export function pushViewed(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, VIEWED_MAX);
}
