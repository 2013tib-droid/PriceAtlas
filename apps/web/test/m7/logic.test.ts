// L5a M7: search offline atas kartu R5 ASLI (D-60, §5.6), simpan/baca `offline_cards` (IndexedDB,
// dikunci saat Keluar, F-81), ajakan pasang iOS (Q-62), banner pembaruan SW (P-12), kerangka S-20
// (§9), aturan cache/persist R5.
import 'fake-indexeddb/auto';
import type { ProductCard } from '@priceatlas/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ASK_TOOLS, askHref, exampleQuestion, screenHref, toolLabel } from '@/lib/ask/ask';
import { shouldPersistQuery, staleTimeFor } from '@/lib/data/query-client';
import { NO_PERSIST_RPCS, qk } from '@/lib/data/query-keys';
import { deleteUserData, lockUserDb, unlockUserDb } from '@/lib/offline/db';
import { firstPhotoPref, isIos, shouldShowInstallPrompt, type InstallEnv } from '@/lib/offline/install';
import {
  matchOfflineCards,
  normalizeForMatch,
  OFFLINE_SYNC_MS,
  readOfflineCards,
  readOfflineCardsByIds,
  replaceOfflineCards,
} from '@/lib/offline/offline-cards';
import { shouldCheckForUpdate, UPDATE_CHECK_MS, updateBanner } from '@/lib/offline/sw-rules';
import { fx, ID } from '../m1/harness';

const names = (cards: ProductCard[]) => cards.map((c) => `${c.product.name} ${c.product.variant ?? ''}`.trim());

describe('search offline di kartu R5 (§5.6)', () => {
  const cards = fx<ProductCard[]>('offline_cache');

  it('normalisasi: huruf kecil, spasi tunggal, tanpa diakritik', () => {
    expect(normalizeForMatch('  Café   LATTE ')).toBe('cafe latte');
    expect(normalizeForMatch('Nestlé')).toBe('nestle');
  });

  it('setiap kata harus cocok (nama + varian + brand, seperti R3)', () => {
    expect(names(matchOfflineCards(cards, 'milo'))).toEqual([
      'Milo 3in1 10 x 35 g',
      'Milo Original 200 g',
      'Milo Original 500 g',
      'Milo UHT 180 ml',
    ]);
    expect(names(matchOfflineCards(cards, 'MILO  uht'))).toEqual(['Milo UHT 180 ml']);
    expect(names(matchOfflineCards(cards, 'milo 500'))).toEqual(['Milo Original 500 g']);
    // Brand (Nestle) dan diakritik.
    expect(matchOfflineCards(cards, 'Nestlé').length).toBe(4);
    expect(names(matchOfflineCards(cards, 'gula'))).toEqual(['Gula Pasir Curah']);
    expect(matchOfflineCards(cards, 'milo actv')).toEqual([]);
    expect(matchOfflineCards(cards, '   ')).toEqual([]);
  });

  it('produk arsip dari R5 (pernah dibuka) disaring, seperti R3', () => {
    const archived = fx<ProductCard[]>('offline_cache_archived');
    expect(archived[0]!.product.status).toBe('archived');
    expect(matchOfflineCards(archived, 'sirup')).toEqual([]);
  });

  it('yang punya data dulu (D-53), lalu kata di awal kata', () => {
    const noData = { ...cards[2]!, product: { ...cards[2]!.product, id: ID.milo1kg, variant: '1 kg' }, summary: null };
    const r = matchOfflineCards([noData, ...cards], 'milo original');
    expect(r[r.length - 1]!.product.id).toBe(ID.milo1kg);
  });
});

describe('store offline_cards (IndexedDB per user)', () => {
  const user = 'b0000000-0000-0000-0000-00000000007a';
  const cards = fx<ProductCard[]>('offline_cache');
  afterEach(async () => {
    unlockUserDb(user);
    await deleteUserData(user);
  });

  it('sinkron mengganti seluruh isi (tanpa duplikat), baca per id', async () => {
    await replaceOfflineCards(user, [...cards, cards[0]!], 1);
    expect((await readOfflineCards(user)).length).toBe(cards.length);
    await replaceOfflineCards(user, cards.slice(0, 2), 2);
    expect((await readOfflineCards(user)).map((c) => c.product.id)).toEqual(
      cards
        .slice(0, 2)
        .map((c) => c.product.id)
        .sort(),
    );
    expect((await readOfflineCardsByIds(user, [ID.gula, ID.unknown, ID.miloUht])).map((c) => c.product.id)).toEqual([
      ID.gula,
      ID.miloUht,
    ]);
  });

  it('setelah Keluar (lockUserDb, F-81): tidak dibaca dan tidak ditulis ulang', async () => {
    await replaceOfflineCards(user, cards, 1);
    lockUserDb(user);
    await deleteUserData(user);
    await expect(replaceOfflineCards(user, cards, 2)).rejects.toThrow();
    expect(await readOfflineCards(user)).toEqual([]);
    const dbs = await indexedDB.databases();
    expect(dbs.map((d) => d.name)).not.toContain(`priceatlas:${user}`);
  });
});

describe('cache query R5 (§4.3, §5.6)', () => {
  it('staleTime 6 jam; hanya meta sinkron yang di-persist, isi struk tetap tidak', () => {
    expect(staleTimeFor(qk.rpc('get_offline_cache'))).toBe(OFFLINE_SYNC_MS);
    expect(OFFLINE_SYNC_MS).toBe(6 * 60 * 60_000);
    const state = { status: 'success' } as never;
    expect(shouldPersistQuery({ queryKey: qk.rpc('get_offline_cache'), state })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ['local', 'offline_cards', 'u', 'search', 'milo'], state })).toBe(false);
    expect([...NO_PERSIST_RPCS].sort()).toEqual(['get_capture_items', 'get_receipt', 'price_record_detail']);
  });
});

describe('ajakan pasang iOS (Q-62, P-04)', () => {
  const env = (userAgent: string, standalone = false, maxTouchPoints = 5): InstallEnv => ({
    userAgent,
    standalone,
    maxTouchPoints,
  });
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Safari';
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';

  it('iPhone dan iPadOS (Macintosh + layar sentuh); Mac dan Android bukan iOS', () => {
    expect(isIos(env(IPHONE))).toBe(true);
    expect(isIos(env(IPAD, false, 5))).toBe(true);
    expect(isIos(env(IPAD, false, 0))).toBe(false);
    expect(isIos(env(ANDROID))).toBe(false);
  });

  it('sekali setelah foto pertama, hanya iOS yang belum dipasang', () => {
    expect(firstPhotoPref(env(IPHONE))).toBe('pending');
    expect(firstPhotoPref(env(IPHONE, true))).toBe('not_needed');
    expect(firstPhotoPref(env(ANDROID))).toBe('not_needed');
    expect(shouldShowInstallPrompt('pending', env(IPHONE))).toBe(true);
    expect(shouldShowInstallPrompt('pending', env(IPHONE, true))).toBe(false);
    expect(shouldShowInstallPrompt('dismissed', env(IPHONE))).toBe(false);
    expect(shouldShowInstallPrompt(null, env(IPHONE))).toBe(false);
  });
});

describe('pembaruan service worker (P-12)', () => {
  it('SW baru menunggu antrean kosong DAN persetujuan user', () => {
    expect(updateBanner({ waiting: false, queueBusy: false })).toBe('hidden');
    expect(updateBanner({ waiting: true, queueBusy: true })).toBe('wait_queue');
    expect(updateBanner({ waiting: true, queueBusy: false })).toBe('ready');
  });

  it('cek versi baru paling sering sekali per jam', () => {
    expect(shouldCheckForUpdate(0, UPDATE_CHECK_MS - 1)).toBe(false);
    expect(shouldCheckForUpdate(0, UPDATE_CHECK_MS)).toBe(true);
  });
});

describe('S-20 Tanya, kerangka (§9)', () => {
  it('nama tool sama dengan packages/ai-tools', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../../../../packages/ai-tools/src/index.ts'), 'utf8');
    const names = [...src.matchAll(/^\s+name: '([a-z_]+)',$/gm)].map((m) => m[1]);
    expect(names.sort()).toEqual([...ASK_TOOLS].sort());
  });

  it('tautan layar sumber (bentuk `layar` keluaran tool)', () => {
    expect(screenHref({ id: 'S-02', kata_kunci: ' milo 500 ' })).toBe('/cari?q=milo%20500');
    expect(screenHref({ id: 'S-02', kata_kunci: ' ' })).toBeNull();
    expect(screenHref({ id: 'S-03', produk_id: ID.milo200 })).toBe(`/produk?id=${ID.milo200}`);
    expect(screenHref({ id: 'S-04', product_group_id: ID.group })).toBe(`/produk/ukuran?group=${ID.group}`);
    expect(screenHref({ id: 'S-05', produk_id: ID.milo200 })).toBe(`/produk/hemat?id=${ID.milo200}`);
    expect(screenHref({ id: 'S-05', product_group_id: ID.group })).toBe(`/produk/hemat?group=${ID.group}`);
    expect(screenHref({ id: 'S-05' })).toBeNull();
  });

  it('label tool, tautan /tanya, contoh pertanyaan', () => {
    expect(toolLabel({ name: 'bandingkan_ukuran', arg: 'Milo Original' })).toBe('bandingkan_ukuran(Milo Original)');
    expect(askHref(' milo paling murah? ')).toBe('/tanya?q=milo%20paling%20murah%3F');
    expect(askHref('')).toBe('/tanya');
    expect(exampleQuestion('milo', 'termurah di mana?')).toBe('milo termurah di mana?');
    expect(exampleQuestion('', 'harga per gram?')).toBe('harga per gram?');
  });
});
