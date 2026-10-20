// IndexedDB per user: `priceatlas:<user_id>` (docs/07 §5.3, P-13). Semua store dibuat di versi 1
// supaya milestone berikutnya (outbox M2, offline_cards M7) tidak perlu migrasi skema.
import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const DB_PREFIX = 'priceatlas:';
const VERSION = 1;

interface PriceAtlasDB extends DBSchema {
  outbox: { key: string; value: { capture_id: string; schemaVersion: number } & Record<string, unknown> };
  outbox_blobs: { key: [string, number]; value: { capture_id: string; position: number; blob: Blob } };
  offline_cards: { key: string; value: { id: string; card: unknown; synced_at: number } };
  qcache: { key: string; value: unknown };
  prefs: { key: string; value: unknown };
  context: { key: string; value: unknown };
}

export type UserDb = IDBPDatabase<PriceAtlasDB>;

const open = new Map<string, Promise<UserDb>>();

export function dbName(userId: string): string {
  return `${DB_PREFIX}${userId}`;
}

export function openUserDb(userId: string): Promise<UserDb> {
  let p = open.get(userId);
  if (!p) {
    p = openDB<PriceAtlasDB>(dbName(userId), VERSION, {
      upgrade(db) {
        db.createObjectStore('outbox', { keyPath: 'capture_id' });
        db.createObjectStore('outbox_blobs', { keyPath: ['capture_id', 'position'] });
        db.createObjectStore('offline_cards', { keyPath: 'id' });
        db.createObjectStore('qcache');
        db.createObjectStore('prefs');
        db.createObjectStore('context');
      },
      // Hapus data (Keluar di tab lain, D-81) atau versi baru menunggu koneksi ini: tutup supaya
      // deleteDB tidak tertahan selamanya; pemanggil berikutnya membuka koneksi baru.
      blocking(_current, _next, event) {
        (event.target as IDBDatabase).close();
        if (open.get(userId) === p) open.delete(userId);
      },
    });
    open.set(userId, p);
  }
  return p;
}

/** Hapus semua data lokal user (keluar / hapus akun, D-81, Q-61). */
export async function deleteUserData(userId: string): Promise<void> {
  const p = open.get(userId);
  open.delete(userId);
  if (p) (await p.catch(() => null))?.close();
  await deleteDB(dbName(userId));
}
