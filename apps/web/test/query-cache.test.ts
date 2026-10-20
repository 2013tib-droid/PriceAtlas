// Aturan cache §4.3 dan persist IndexedDB (§5.3) dengan fake-indexeddb.
import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { createIdbPersister, shouldPersistQuery, staleTimeFor, startPersist } from '@/lib/data/query-client';
import { qk } from '@/lib/data/query-keys';
import { dbName, deleteUserData, openUserDb } from '@/lib/offline/db';

const USER = '00000000-0000-0000-0000-00000000000a';
const success = { status: 'success' } as never;

describe('aturan cache (§4.3)', () => {
  it('staleTime per RPC', () => {
    expect(staleTimeFor(qk.rpc('get_my_context'))).toBe(3_600_000);
    expect(staleTimeFor(qk.rpc('search_products', { p_query: 'milo' }))).toBe(30_000);
    expect(staleTimeFor(qk.rpc('list_captures'))).toBe(0);
    expect(staleTimeFor(qk.rpc('get_receipt', { p_receipt_id: USER }))).toBe(0);
  });

  it('isi struk dan detail record tidak di-persist (P-13, P-14)', () => {
    expect(shouldPersistQuery({ queryKey: qk.rpc('get_my_context'), state: success })).toBe(true);
    expect(shouldPersistQuery({ queryKey: qk.rpc('search_products', { p_query: 'milo' }), state: success })).toBe(true);
    for (const name of ['get_receipt', 'get_capture_items', 'price_record_detail'] as const) {
      expect(shouldPersistQuery({ queryKey: ['rpc', name, {}], state: success }), name).toBe(false);
    }
    expect(shouldPersistQuery({ queryKey: qk.rpc('get_my_context'), state: { status: 'error' } as never })).toBe(false);
    expect(shouldPersistQuery({ queryKey: ['lain'], state: success })).toBe(false);
  });
});

describe('persist ke IndexedDB per user', () => {
  it('database bernama priceatlas:<user_id> dengan semua store §5.3', async () => {
    const db = await openUserDb(USER);
    expect(db.name).toBe(dbName(USER));
    expect([...db.objectStoreNames].sort()).toEqual([
      'context',
      'offline_cards',
      'outbox',
      'outbox_blobs',
      'prefs',
      'qcache',
    ]);
  });

  it('cache dipulihkan setelah reload, tanpa data struk', async () => {
    const a = new QueryClient();
    const { unsubscribe, restored } = startPersist(a, USER);
    await restored;
    a.setQueryData(qk.rpc('get_my_context'), { user_id: USER });
    a.setQueryData(qk.rpc('get_receipt', { p_receipt_id: USER }), { lines: ['rahasia'] });
    // persistQueryClient men-throttle penulisan (1 dtk); paksa tulis sekarang.
    await new Promise((r) => setTimeout(r, 1100));
    unsubscribe();

    const saved = await createIdbPersister(USER).restoreClient();
    const keys = saved?.clientState.queries.map((q) => q.queryKey[1]);
    expect(keys).toContain('get_my_context');
    expect(keys).not.toContain('get_receipt');

    const b = new QueryClient();
    const second = startPersist(b, USER);
    await second.restored;
    second.unsubscribe();
    expect(b.getQueryData(qk.rpc('get_my_context'))).toEqual({ user_id: USER });
    expect(b.getQueryData(qk.rpc('get_receipt', { p_receipt_id: USER }))).toBeUndefined();
  });

  it('keluar menghapus seluruh database user (Q-61)', async () => {
    await openUserDb(USER);
    await deleteUserData(USER);
    const dbs = await indexedDB.databases();
    expect(dbs.map((d) => d.name)).not.toContain(dbName(USER));
  });
});
