// TanStack Query v5 + persist ke IndexedDB (D-80, docs/07 §4.3, §5.3 store `qcache`).
import { QueryClient, type Query } from '@tanstack/react-query';
import { persistQueryClient, type PersistedClient, type Persister } from '@tanstack/react-query-persist-client';
import type { RpcName } from '@priceatlas/contracts';
import { openUserDb } from '@/lib/offline/db';
import { toAppError } from './errors';
import { DEFAULT_STALE_TIME, NO_PERSIST_RPCS, STALE_TIME } from './query-keys';

/** Persist kedaluwarsa 7 hari (§5.3). */
export const PERSIST_MAX_AGE = 7 * 24 * 60 * 60_000;
/** Ganti nilai ini jika bentuk data cache berubah tidak kompatibel. */
export const PERSIST_BUSTER = 'v1';

export function staleTimeFor(queryKey: readonly unknown[]): number {
  return queryKey[0] === 'rpc' ? (STALE_TIME[queryKey[1] as RpcName] ?? DEFAULT_STALE_TIME) : DEFAULT_STALE_TIME;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: (q) => staleTimeFor(q.queryKey),
        gcTime: PERSIST_MAX_AGE,
        // Error bisnis (4xx) tidak diulang; jaringan diulang sampai 2 kali.
        retry: (count, err) => toAppError(err).kind === 'network' && count < 2,
        // "offlineFirst": data cache tetap tampil saat offline (wireframe §5.5).
        networkMode: 'offlineFirst',
        refetchOnWindowFocus: true,
      },
      mutations: { networkMode: 'online', retry: false },
    },
  });
}

/** Aturan persist §4.3: hanya query RPC yang sukses, kecuali isi struk/detail record. */
export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const [scope, name] = query.queryKey;
  return query.state.status === 'success' && scope === 'rpc' && !NO_PERSIST_RPCS.has(String(name));
}

const QCACHE_KEY = 'client';

export function createIdbPersister(userId: string): Persister {
  return {
    async persistClient(client: PersistedClient) {
      const db = await openUserDb(userId);
      await db.put('qcache', client, QCACHE_KEY);
    },
    async restoreClient() {
      const db = await openUserDb(userId);
      return (await db.get('qcache', QCACHE_KEY)) as PersistedClient | undefined;
    },
    async removeClient() {
      const db = await openUserDb(userId);
      await db.delete('qcache', QCACHE_KEY);
    },
  };
}

// Janji "cache persist sudah dipulihkan" per user. Bisa diminta sebelum startPersist dipanggil (effect
// komponen anak berjalan sebelum effect AuthProvider), jadi dibuat tertunda lalu diselesaikan nanti.
const restoredByUser = new Map<string, { promise: Promise<void>; resolve: () => void }>();
function restoredEntry(userId: string) {
  let e = restoredByUser.get(userId);
  if (!e) {
    let resolve = () => undefined as void;
    const promise = new Promise<void>((r) => (resolve = r));
    e = { promise, resolve };
    restoredByUser.set(userId, e);
  }
  return e;
}

/** Selesai memulihkan cache persist user ini (TanStack `persistQueryClient`). */
export function whenRestored(userId: string): Promise<void> {
  return restoredEntry(userId).promise;
}

/** Mulai persist untuk user ini. Mengembalikan fungsi berhenti dan janji pemulihan cache. */
export function startPersist(queryClient: QueryClient, userId: string) {
  const [unsubscribe, restored] = persistQueryClient({
    queryClient,
    persister: createIdbPersister(userId),
    maxAge: PERSIST_MAX_AGE,
    buster: PERSIST_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  });
  const entry = restoredEntry(userId);
  restored.then(entry.resolve, entry.resolve);
  return {
    unsubscribe: () => {
      unsubscribe();
      // Persist berikutnya (login lagi, pasang ulang) memulihkan lagi: janji baru.
      if (restoredByUser.get(userId) === entry) restoredByUser.delete(userId);
    },
    restored,
  };
}
