// @vitest-environment jsdom
// L5b M7: cache produk R5 + search offline (D-60, §5.6) di S-01/S-02/S-03, Keluar menghapus cache
// (F-81), S-20 Tanya kerangka (§9), ajakan pasang iOS (Q-62), banner pembaruan SW (P-12). Keluaran
// R5 ASLI (test/fixtures/rpc.json `offline_cache`).
import '../m1/mocks';
import type { ProductCard } from '@priceatlas/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  freezeToday,
  fx,
  ID,
  installDomPolyfills,
  nav,
  renderWithProviders,
  resetHarness,
  sb,
  setUrl,
  state,
} from '../m1/harness';

const { OfflineCacheSync } = await import('@/lib/data/offline-cache');
const { invalidateAfterPriceWrite } = await import('@/lib/data/confirm');
const { SearchScreen } = await import('@/features/search/search-screen');
const { SearchLayout } = await import('@/features/search/search-layout');
const { HomeScreen } = await import('@/features/home/home-screen');
const { ProductScreen } = await import('@/features/product/product-screen');
const { AskScreen } = await import('@/features/ask/ask-screen');
const { AskMessage } = await import('@/features/ask/ask-parts');
const { FirstPhotoWatcher, InstallPrompt } = await import('@/components/app/install-prompt');
const { SwUpdateBanner } = await import('@/components/app/sw-update');
const { signOutAndClear } = await import('@/lib/auth/session');
const { readOfflineCards, replaceOfflineCards } = await import('@/lib/offline/offline-cards');
const { readPref, writePref, PREF_KEYS } = await import('@/lib/offline/prefs');
const { OutboxStore, newItem } = await import('@/lib/offline/outbox-store');

installDomPolyfills();

const r5Calls = () => sb.rpc.mock.calls.filter(([fn]) => fn === 'get_offline_cache');
const goOffline = () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  act(() => void window.dispatchEvent(new Event('offline')));
};
const seedCards = () => replaceOfflineCards(ID.user, fx<ProductCard[]>('offline_cache'), Date.now());
const neverResolves = (name: string) => (fn: string) => (fn === name ? new Promise<never>(() => undefined) : undefined);

beforeEach(async () => {
  await resetHarness();
  freezeToday();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sinkron R5 (D-60, §5.6)', () => {
  it('setelah login: R5 dengan "pernah dibuka" (prefs) + 50 teratas → offline_cards', async () => {
    await writePref(ID.user, PREF_KEYS.viewed, [ID.miloUht, ID.gula]);
    await renderWithProviders(<OfflineCacheSync />);
    await waitFor(() => expect(r5Calls()).toHaveLength(1));
    expect(r5Calls()[0]![1]).toEqual({ p_viewed_ids: [ID.miloUht, ID.gula], p_top: 50 });
    await waitFor(async () => expect((await readOfflineCards(ID.user)).length).toBe(6));
  });

  it('tidak sinkron ulang dalam 6 jam; tulis harga (konfirmasi struk) → sinkron ulang', async () => {
    const { qc } = await renderWithProviders(<OfflineCacheSync />);
    await waitFor(() => expect(r5Calls()).toHaveLength(1));
    await act(() => qc.refetchQueries({ type: 'active', stale: true }));
    expect(r5Calls()).toHaveLength(1);
    await act(() => invalidateAfterPriceWrite(qc, [ID.milo200]));
    await waitFor(() => expect(r5Calls()).toHaveLength(2));
  });

  it('buka app lagi dalam 6 jam: cache persist dipulihkan dulu, R5 tidak dipanggil ulang', async () => {
    const first = await renderWithProviders(<OfflineCacheSync />);
    await waitFor(() => expect(r5Calls()).toHaveLength(1));
    // persistQueryClient menulis ke IndexedDB dengan jeda ±1 dtk.
    await new Promise((r) => setTimeout(r, 1500));
    first.unmount();
    await renderWithProviders(<OfflineCacheSync />);
    await new Promise((r) => setTimeout(r, 500));
    expect(r5Calls()).toHaveLength(1);
  });

  it('Keluar: offline_cards ikut terhapus dan tidak dibuat ulang (F-81)', async () => {
    const { qc } = await renderWithProviders(<OfflineCacheSync />);
    await waitFor(async () => expect((await readOfflineCards(ID.user)).length).toBe(6));
    await act(() => signOutAndClear(ID.user, qc));
    await expect(replaceOfflineCards(ID.user, fx<ProductCard[]>('offline_cache'), 1)).rejects.toThrow();
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(`priceatlas:${ID.user}`);
  });
});

describe('S-02 offline (§5.6)', () => {
  async function renderSearch(q: string) {
    setUrl('/cari', `q=${encodeURIComponent(q)}`);
    return renderWithProviders(
      <SearchLayout>
        <SearchScreen />
      </SearchLayout>,
    );
  }

  it('offline tanpa hasil R3 tersimpan → kartu R5 + label "data tersimpan"', async () => {
    await seedCards();
    state.rpcOverride = neverResolves('search_products');
    goOffline();
    await renderSearch('milo');
    expect(await screen.findByText(/4 produk untuk "milo" · data tersimpan, mungkin tidak terbaru/)).toBeTruthy();
    expect(screen.getAllByTestId('product-card')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: /Milo UHT/ })).toBeTruthy();
  });

  it('kata kunci baru saat offline: bukan hasil kata sebelumnya (placeholder), tetapi kartu R5', async () => {
    await seedCards();
    const view = await renderSearch('milo');
    await screen.findByText('5 produk untuk "milo"');
    state.rpcOverride = neverResolves('search_products');
    goOffline();
    setUrl('/cari', 'q=gula');
    view.rerenderUi(
      <SearchLayout>
        <SearchScreen />
      </SearchLayout>,
    );
    expect(await screen.findByText(/1 produk untuk "gula" · data tersimpan/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Milo UHT/ })).toBeNull();
  });

  it('offline, tidak ada di data tersimpan → pesan khusus', async () => {
    await seedCards();
    state.rpcOverride = neverResolves('search_products');
    goOffline();
    await renderSearch('indomie');
    expect(
      await screen.findByText('Tidak ada "indomie" di data yang tersimpan di HP. Coba lagi saat ada sinyal.'),
    ).toBeTruthy();
  });

  it('jaringan gagal (navigator.onLine tetap true) → baris "Tidak ada sinyal" + kartu R5', async () => {
    await seedCards();
    state.rpcOverride = (fn) => {
      if (fn === 'search_products') throw new TypeError('Failed to fetch');
      return undefined;
    };
    await renderSearch('gula');
    expect(await screen.findByText('Tidak ada sinyal. Data yang terakhir dimuat tetap ditampilkan.')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /Gula Pasir Curah/ })).toBeTruthy();
  });

  it('baris "Tanya: …" membuka S-20 (D-85)', async () => {
    await renderSearch('milo');
    const ask = await screen.findByRole('link', { name: /Tanya: milo/ });
    expect(ask.getAttribute('href')).toBe('/tanya?q=milo');
  });
});

describe('S-01 dan S-03 offline', () => {
  it('S-01 "Baru dicek" dari kartu R5 saat R4 belum tersimpan', async () => {
    await seedCards();
    await writePref(ID.user, PREF_KEYS.viewed, [ID.gula, ID.miloUht]);
    state.rpcOverride = (fn) =>
      fn === 'get_product_cards' || fn === 'search_products' ? new Promise<never>(() => undefined) : undefined;
    goOffline();
    await renderWithProviders(
      <SearchLayout>
        <HomeScreen />
      </SearchLayout>,
    );
    const viewed = within(await screen.findByRole('region', { name: 'Baru dicek' }));
    await waitFor(() => expect(viewed.getAllByRole('link')).toHaveLength(2));
    expect(viewed.getAllByRole('link')[0]!.textContent).toContain('Gula Pasir Curah');
  });

  it('S-03 offline: ringkasan kartu tersimpan saja + "Detail lengkap butuh sinyal"', async () => {
    await seedCards();
    state.rpcOverride = neverResolves('get_product_detail');
    goOffline();
    setUrl('/produk', `id=${ID.milo200}`);
    await renderWithProviders(<ProductScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: /Milo Original/ })).toBeTruthy();
    expect(screen.getByText('Detail lengkap butuh sinyal.')).toBeTruthy();
    expect(screen.getByText('data tersimpan, mungkin tidak terbaru')).toBeTruthy();
    expect(screen.getByTestId('product-card').textContent).toContain('Rp');
    // Tanpa grafik/histori.
    expect(screen.queryByRole('heading', { name: 'Histori harga' })).toBeNull();
  });

  it('S-03 offline tanpa kartu tersimpan: pesan offline', async () => {
    state.rpcOverride = neverResolves('get_product_detail');
    goOffline();
    setUrl('/produk', `id=${ID.milo200}`);
    await renderWithProviders(<ProductScreen />);
    expect(await screen.findByText(/Tidak ada sinyal, dan data ini belum tersimpan di HP/)).toBeTruthy();
  });
});

describe('S-20 Tanya (kerangka, §9)', () => {
  it('pertanyaan dari S-02, "Segera hadir" + tautan hasil cari, kirim nonaktif, tanpa RPC', async () => {
    setUrl('/tanya', 'q=milo');
    await renderWithProviders(<AskScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tanya' })).toBeTruthy();
    expect(screen.getByText('milo')).toBeTruthy();
    expect(screen.getAllByText(/^Segera hadir\. Untuk sekarang, pakai hasil cari/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Lihat hasil cari "milo"' }).getAttribute('href')).toBe('/cari?q=milo');
    const send = screen.getByRole('button', { name: 'Kirim' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByLabelText('Pertanyaan') as HTMLInputElement;
    expect(input.value).toBe('milo');
    await userEvent.setup().click(screen.getByRole('button', { name: 'termurah di mana?' }));
    expect(input.value).toBe('milo termurah di mana?');
    expect(sb.rpc).not.toHaveBeenCalledWith(
      expect.not.stringMatching(/get_my_context|get_offline_cache/),
      expect.anything(),
    );
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('keadaan balasan dengan data contoh: jawaban, di luar kemampuan, data kurang, ambigu, memuat', async () => {
    const onPick = vi.fn();
    await renderWithProviders(
      <ul>
        <AskMessage
          question="milo 500 atau 200 yang lebih hemat?"
          reply={{
            kind: 'answer',
            text: '500 g lebih hemat per gram: Rp91,8/g vs Rp97,5/g (6% lebih murah).',
            basis: 'Berdasarkan harga terbaik 90 hari di historimu (9 data, terakhir 12 Okt).',
            tool: { name: 'bandingkan_ukuran', arg: 'Milo Original' },
            screen: { id: 'S-04', product_group_id: ID.group },
          }}
        />
        <AskMessage question="resep pakai milo" reply={{ kind: 'out_of_scope' }} />
        <AskMessage
          question="milo 200 naik atau turun?"
          reply={{
            kind: 'not_enough',
            text: 'Baru ada 1 data untuk Milo 200g. Belum cukup untuk tren.',
            tool: { name: 'tren_harga', arg: 'Milo Original 200 g' },
            screen: { id: 'S-03', produk_id: ID.milo200 },
          }}
        />
        <AskMessage
          question="milo termurah di mana?"
          onPick={onPick}
          reply={{
            kind: 'ambiguous',
            options: [
              { label: 'Milo Original', question: 'Milo Original termurah di mana?' },
              { label: 'Milo 3in1', question: 'Milo 3in1 termurah di mana?' },
            ],
          }}
        />
        <AskMessage question="harga per gram milo?" reply={{ kind: 'loading' }} />
      </ul>,
    );
    expect(screen.getByRole('link', { name: 'Lihat perbandingan ukuran' }).getAttribute('href')).toBe(
      `/produk/ukuran?group=${ID.group}`,
    );
    expect(screen.getByText('bandingkan_ukuran(Milo Original)')).toBeTruthy();
    expect(screen.getByText(/Saya hanya bisa menjawab dari histori hargamu/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lihat detail produk' }).getAttribute('href')).toBe(
      `/produk?id=${ID.milo200}`,
    );
    expect(screen.getByRole('heading', { name: 'Maksudmu yang mana?' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Milo 3in1' }));
    expect(onPick).toHaveBeenCalledWith('Milo 3in1 termurah di mana?');
    expect(screen.getByRole('status').textContent).toBe('Mencari di historimu…');
  });
});

describe('ajakan pasang iOS + storage.persist (Q-62, P-04)', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Safari';
  const addPhoto = () =>
    OutboxStore.forUser(ID.user).add(
      newItem({
        capture_id: '11111111-0000-0000-0000-000000000077',
        kind: 'receipt',
        household_id: null,
        shopping_session_id: null,
        store_id: null,
        branch_id: null,
        captured_at: null,
        parts: [{ position: 1, ext: 'jpg', content_type: 'image/jpeg', sha256: 'a', byte_size: 1 }],
      }),
      new Map(),
    );
  const stubDevice = (userAgent: string) => {
    const persist = vi.fn(async () => true);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist, persisted: vi.fn(async () => false) },
    });
    return persist;
  };

  it('iPhone: foto pertama → persist() + ajakan sekali; ditutup → tidak tampil lagi', async () => {
    const persist = stubDevice(IPHONE);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addPhoto();
    const view = await renderWithProviders(
      <>
        <FirstPhotoWatcher />
        <InstallPrompt />
      </>,
    );
    expect(await screen.findByRole('heading', { name: 'Pasang PriceAtlas ke layar utama' })).toBeTruthy();
    expect(persist).toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nanti saja' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Pasang PriceAtlas/ })).toBeNull());
    expect(await readPref(ID.user, PREF_KEYS.installPrompt, null)).toBe('dismissed');
    view.unmount();
  });

  it('Android: persist() diminta, tanpa ajakan (prompt bawaan browser)', async () => {
    const persist = stubDevice('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/126 Mobile Safari/537.36');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addPhoto();
    await renderWithProviders(
      <>
        <FirstPhotoWatcher />
        <InstallPrompt />
      </>,
    );
    await waitFor(async () => expect(await readPref(ID.user, PREF_KEYS.installPrompt, null)).toBe('not_needed'));
    expect(persist).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: /Pasang PriceAtlas/ })).toBeNull();
  });

  it('belum ada foto: tidak ada ajakan, persist() belum diminta', async () => {
    const persist = stubDevice(IPHONE);
    await renderWithProviders(
      <>
        <FirstPhotoWatcher />
        <InstallPrompt />
      </>,
    );
    await act(async () => undefined);
    expect(persist).not.toHaveBeenCalled();
    expect(await readPref(ID.user, PREF_KEYS.installPrompt, null)).toBeNull();
  });
});

describe('banner pembaruan SW (P-12)', () => {
  function stubServiceWorker() {
    const waiting = Object.assign(new EventTarget(), { state: 'installed', postMessage: vi.fn() });
    const reg = Object.assign(new EventTarget(), { waiting, installing: null, update: vi.fn(async () => undefined) });
    const container = Object.assign(new EventTarget(), {
      controller: {},
      getRegistration: vi.fn(async () => reg),
    });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
    return { waiting, reg };
  }
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('antrean berisi: hanya pemberitahuan, SW baru tidak mengambil alih', async () => {
    const { waiting } = stubServiceWorker();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await OutboxStore.forUser(ID.user).add(
      newItem({
        capture_id: '11111111-0000-0000-0000-000000000078',
        kind: 'price_label',
        household_id: null,
        shopping_session_id: null,
        store_id: null,
        branch_id: null,
        captured_at: null,
        parts: [{ position: 1, ext: 'jpg', content_type: 'image/jpeg', sha256: 'b', byte_size: 1 }],
      }),
      new Map(),
    );
    await renderWithProviders(<SwUpdateBanner />);
    expect(await screen.findByText('Versi baru siap. Dipasang setelah semua foto terunggah.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Muat ulang' })).toBeNull();
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  it('antrean kosong: "Muat ulang" → SKIP_WAITING', async () => {
    const { waiting } = stubServiceWorker();
    await renderWithProviders(<SwUpdateBanner />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Muat ulang' }));
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('PWA lama terbuka: cek versi saat kembali terlihat (paling sering sekali per jam)', async () => {
    const { reg } = stubServiceWorker();
    await renderWithProviders(<SwUpdateBanner />);
    await screen.findByRole('button', { name: 'Muat ulang' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(reg.update).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 61 * 60_000);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(reg.update).toHaveBeenCalledTimes(1);
  });
});
