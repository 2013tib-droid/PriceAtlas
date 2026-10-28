// @vitest-environment jsdom
// L5b M4: S-12 mode sesi (W11), S-13 Sesi belanja di setiap keadaan §7.3, SessionBanner (U-13), dan
// S-06 dengan/tanpa sesi (U-08). Data: R18/W11/W12/W13 + R17 + REST store/branch ASLI
// (test/fixtures/rpc.json, mode A + pipeline worker).
import '../m1/mocks';
import type { ActiveSession } from '@priceatlas/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fx, ID, installDomPolyfills, nav, renderWithProviders, resetHarness, sb, setUrl, state } from '../m1/harness';

const { LocationScreen } = await import('@/features/location/location-screen');
const { ShoppingScreen } = await import('@/features/shopping/shopping-screen');
const { SessionBanner } = await import('@/components/app/session-banner');
const { PhotoSheet } = await import('@/components/app/photo-sheet');
const { OutboxStore, newItem } = await import('@/lib/offline/outbox-store');
const { readPref, writePref, PREF_KEYS } = await import('@/lib/offline/prefs');

installDomPolyfills();

const AEON_BSD = '30000000-0000-0000-0000-000000000001';
const AEON_LAMA = '30000000-0000-0000-0000-000000000003';
const MIN = 60_000;
const err = (key: string) => ({ data: null, error: fx<{ error: unknown }>(key).error });
const rpcCalls = (fn: string) =>
  sb.rpc.mock.calls.filter(([f]) => f === fn).map(([, a]) => a as Record<string, unknown>);
/** R18 untuk test ini. */
const withSession = (key: string | null) => {
  state.rpcOverride = (fn) => (fn === 'get_active_session' ? { data: key ? fx(key) : null, error: null } : undefined);
};
/** Jam perangkat relatif terhadap sesi fixture (hanya Date dipalsukan; timer tetap asli). */
const clockAt = (iso: string, deltaMs: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.parse(iso) + deltaMs));
};
const setOnline = (v: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: v });
  window.dispatchEvent(new Event(v ? 'online' : 'offline'));
};

beforeEach(async () => {
  await resetHarness();
});
afterEach(() => {
  vi.useRealTimers();
  // onlineManager TanStack mengikuti event online/offline (mutasi 'online' tertahan saat offline).
  setOnline(true);
});

describe('S-12 mode sesi (W11, D-60, W-19)', () => {
  const open = async (query = 'mode=sesi') => {
    setUrl('/lokasi', query);
    return renderWithProviders(<LocationScreen />);
  };
  const pickAeon = async () => {
    const user = userEvent.setup();
    await user.click(within((await screen.findAllByTestId('store-row'))[0]!).getByRole('button'));
    return user;
  };

  it('judul "Kamu belanja di mana?"; cabang tutup di bawah dan tidak bisa dipilih; tanpa "Tidak tahu cabangnya"', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Kamu belanja di mana?');
    await pickAeon();
    const rows = await screen.findAllByTestId('branch-row');
    expect(rows.map((r) => r.textContent)).toEqual(['AEON BSDTangerang', 'AEON LamaTangerang(tutup)']);
    expect(within(rows[0]!).getByRole('button')).toHaveProperty('disabled', false);
    expect(within(rows[1]!).getByRole('button')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Tidak tahu cabangnya' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Cabang baru' })).toBeTruthy();
  });

  it('pilih cabang → W11 dengan id dari klien → toast + ke /belanja', async () => {
    await open();
    const user = await pickAeon();
    await user.click(within((await screen.findAllByTestId('branch-row'))[0]!).getByRole('button'));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/belanja'));
    const [call] = rpcCalls('start_shopping_session');
    expect(call).toEqual({ p_session_id: expect.stringMatching(/^[0-9a-f-]{36}$/), p_branch_id: AEON_BSD });
    expect(toast.success).toHaveBeenCalledWith('Sesi belanja dimulai di AEON BSD.');
  });

  it('BRANCH_CLOSED → pesan §8.2; mengulang cabang yang sama memakai id sesi yang sama (F-16)', async () => {
    state.rpcOverride = (fn) => (fn === 'start_shopping_session' ? err('session_start_closed') : undefined);
    await open();
    const user = await pickAeon();
    const row = within((await screen.findAllByTestId('branch-row'))[0]!).getByRole('button');
    await user.click(row);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cabang ini sudah tutup. Pilih cabang lain atau tambah cabang baru.',
    );
    expect(nav.replace).not.toHaveBeenCalled();
    await user.click(row);
    await waitFor(() => expect(rpcCalls('start_shopping_session')).toHaveLength(2));
    const [a, b] = rpcCalls('start_shopping_session');
    expect(a!.p_session_id).toBe(b!.p_session_id);
  });

  it('"+ Cabang baru" (W17) langsung memulai sesi di cabang baru', async () => {
    await open();
    const user = await pickAeon();
    await user.click(await screen.findByRole('button', { name: '+ Cabang baru' }));
    await user.type(screen.getByLabelText('Nama cabang'), 'AEON Alam Sutera');
    await user.click(screen.getByRole('button', { name: 'Tambah cabang' }));
    await waitFor(() => expect(rpcCalls('start_shopping_session')).toHaveLength(1));
    const branch = rpcCalls('create_private_branch')[0]!.p_branch as { id: string };
    expect(rpcCalls('start_shopping_session')[0]!.p_branch_id).toBe(branch.id);
  });

  it('"Terakhir dipakai" dengan cabang → 1 ketukan memulai sesi; kembali= dihormati', async () => {
    await open(`mode=sesi&kembali=${encodeURIComponent('/produk?id=x')}`);
    await userEvent.setup().click(within((await screen.findAllByTestId('recent-location'))[1]!).getByRole('button'));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/produk?id=x'));
    expect(rpcCalls('start_shopping_session')[0]!.p_branch_id).toBe(AEON_BSD);
  });

  it('offline: mulai sesi butuh sinyal (D-81/Q-54), W11 tidak dipanggil', async () => {
    await open();
    const user = await pickAeon();
    const row = within((await screen.findAllByTestId('branch-row'))[0]!).getByRole('button');
    act(() => setOnline(false));
    await user.click(row);
    expect(screen.getAllByText(/Memulai atau mengubah sesi belanja butuh sinyal/).length).toBeGreaterThan(0);
    expect(rpcCalls('start_shopping_session')).toHaveLength(0);
  });

  it('mode manual untuk label (F-53): pilihan → kamera label dengan lokasi manual', async () => {
    await open(`mode=manual&untuk=label&kembali=${encodeURIComponent('/kamera?jenis=label')}`);
    const user = await pickAeon();
    await user.click(await screen.findByRole('button', { name: 'Tidak tahu cabangnya' }));
    expect(nav.replace).toHaveBeenCalledWith(`/kamera?jenis=label&toko=${ID.aeon}`);
    await user.click(within((await screen.findAllByTestId('branch-row'))[0]!).getByRole('button'));
    expect(nav.replace).toHaveBeenLastCalledWith(`/kamera?jenis=label&toko=${ID.aeon}&cabang=${AEON_BSD}`);
    expect(rpcCalls('start_shopping_session')).toHaveLength(0);
    void AEON_LAMA;
  });
});

describe('S-13 Sesi belanja', () => {
  const open = async () => {
    setUrl('/belanja');
    return renderWithProviders(<ShoppingScreen />);
  };

  it('memuat: skeleton', async () => {
    state.rpcOverride = (fn) => (fn === 'get_active_session' ? new Promise(() => undefined) : undefined);
    await open();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('tanpa sesi: ajakan + "Mulai belanja" → S-12 mode sesi + sesi terakhir (R17, 1 ketukan W11)', async () => {
    await open();
    expect(await screen.findByText(/Lagi di toko\? Mulai sesi/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mulai belanja' }).getAttribute('href')).toBe('/lokasi?mode=sesi');
    const recent = await screen.findAllByTestId('recent-session');
    expect(recent.map((r) => r.textContent)).toEqual([
      'Nestle Official StoreShopee',
      'AEON BSDAEON',
      'Alfamart SerpongAlfamart',
    ]);
    await userEvent.setup().click(within(recent[1]!).getByRole('button'));
    await waitFor(() => expect(rpcCalls('start_shopping_session')[0]!.p_branch_id).toBe(AEON_BSD));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sesi belanja dimulai di AEON BSD.'));
  });

  it('aktif tanpa label: judul, jam mulai/berakhir (zona household), "Foto label harga pertama."', async () => {
    const s = fx<ActiveSession>('session_start');
    clockAt(s.session.started_at, 5 * MIN);
    withSession('session_start');
    await open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Belanja di AEON BSD' })).toBeTruthy();
    expect(screen.getByText(/^Mulai \d{2}:\d{2} · berakhir otomatis \d{2}:\d{2}$/)).toBeTruthy();
    expect(screen.getByText('Mulai 15:01 · berakhir otomatis 19:01')).toBeTruthy();
    expect(screen.getByText('Label di sesi ini (0)')).toBeTruthy();
    expect(screen.getByText('Foto label harga pertama.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Perpanjang' })).toBeNull();
    // "Akhiri sesi" kecil di kiri, "Foto label" besar di kanan.
    const actions = screen.getAllByRole('button').filter((b) => /Akhiri sesi|Foto label/.test(b.textContent ?? ''));
    expect(actions.map((b) => b.textContent)).toEqual(['Akhiri sesi', 'Foto label']);
    await userEvent.setup().click(actions[1]!);
    expect(nav.push).toHaveBeenCalledWith('/kamera?jenis=label');
  });

  it('aktif dengan label: diproses / gagal / tersimpan (harga + label + vs_best_pct) / perlu dicek', async () => {
    const s = fx<ActiveSession>('session_labels');
    clockAt(s.session.started_at, 30 * MIN);
    withSession('session_labels');
    await open();
    expect(await screen.findByText('Label di sesi ini (4)')).toBeTruthy();
    const rows = screen.getAllByTestId('session-label');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Foto labeldiproses…',
      'Foto labelgagal dibaca',
      'Milo Original 200 gRp17.500PROMO3% lebih murah dari biasanya',
      'Milo 3in1 10 × 35 gRp23.000NORMAL',
      // 6b M4 (Q-81): foto yang masih perlu dicek — item yang sudah tersimpan tampil dengan harga,
      // item pending dengan "perlu dicek".
      'Milo Original 200 gRp17.500PROMO3% lebih murah dari biasanya',
      'Milo 3in1 10 × 35 gperlu dicek',
    ]);
    const failed = s.labels.find((l) => l.status === 'failed')!.capture_id;
    const needs = s.labels.find((l) => l.status === 'needs_confirmation')!.capture_id;
    expect(within(rows[1]!).getByRole('link').getAttribute('href')).toBe(`/unggahan/detail?id=${failed}`);
    expect(
      within(rows[5]!)
        .getByRole('link', { name: /Cek label Milo 3in1/ })
        .getAttribute('href'),
    ).toBe(`/konfirmasi?capture=${needs}`);
  });

  it('setelah ringkasan diperbarui: tetap "lebih murah dari biasanya" (F-60 → Q-80/Q-81, 6b M4)', async () => {
    const s = fx<ActiveSession>('session_labels_refreshed');
    clockAt(s.session.started_at, 30 * MIN);
    withSession('session_labels_refreshed');
    await open();
    // Milo 200 g (dua label): −2,8 % terhadap histori di luar sesi. Milo 3in1 hanya punya record dari sesi ini
    // → tanpa pembanding.
    expect((await screen.findAllByText('3% lebih murah dari biasanya')).length).toBe(2);
    expect(screen.queryByText('setara harga terbaikmu')).toBeNull();
    expect(screen.getAllByTestId('session-label').map((r) => r.textContent)).toContain(
      'Milo 3in1 10 × 35 gRp23.000NORMAL',
    );
  });

  it('hampir kedaluwarsa (< 30 mnt) → "Perpanjang" (W12) → toast jam berakhir baru', async () => {
    const s = fx<ActiveSession>('session_near_expiry');
    clockAt(s.session.expires_at, -20 * MIN);
    withSession('session_near_expiry');
    await open();
    expect(await screen.findByText('Sesi berakhir 20 menit lagi.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Perpanjang' }));
    await waitFor(() => expect(rpcCalls('extend_shopping_session')).toEqual([{ p_session_id: s.session.id }]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sesi diperpanjang sampai 17:21.'));
  });

  it('perpanjang sesi yang sudah berakhir → SESSION_NOT_ACTIVE + "Mulai sesi baru"', async () => {
    const s = fx<ActiveSession>('session_near_expiry');
    clockAt(s.session.expires_at, -10 * MIN);
    state.rpcOverride = (fn) =>
      fn === 'get_active_session'
        ? { data: fx('session_near_expiry'), error: null }
        : fn === 'extend_shopping_session'
          ? err('session_extend_ended')
          : undefined;
    await open();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Perpanjang' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch('Sesi belanja ini sudah berakhir. Mulai sesi baru untuk lanjut.');
    expect(within(alert).getByRole('link', { name: 'Mulai sesi baru' }).getAttribute('href')).toBe('/lokasi?mode=sesi');
  });

  it('"Akhiri sesi" (W13) → toast ringkasan → keadaan tanpa sesi', async () => {
    const s = fx<ActiveSession>('session_labels');
    clockAt(s.session.started_at, 30 * MIN);
    let ended = false;
    state.rpcOverride = (fn) => {
      if (fn === 'get_active_session') return { data: ended ? null : fx('session_labels'), error: null };
      if (fn === 'end_shopping_session') {
        ended = true;
        return { data: fx('session_end'), error: null };
      }
      return undefined;
    };
    await open();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Akhiri sesi' }));
    await waitFor(() => expect(rpcCalls('end_shopping_session')).toEqual([{ p_session_id: s.session.id }]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sesi di AEON BSD diakhiri. 4 label tersimpan.'));
    expect(await screen.findByRole('link', { name: 'Mulai belanja' })).toBeTruthy();
  });

  it('kedaluwarsa (D-43): R18 null + sesi yang diingat → teks ringkasan + "Mulai sesi baru"', async () => {
    const s = fx<ActiveSession>('session_labels');
    await writePref(ID.user, PREF_KEYS.lastSession, {
      id: s.session.id,
      place: 'AEON BSD',
      expires_at: s.session.expires_at,
      label_count: 4,
    });
    clockAt(s.session.expires_at, 5 * MIN);
    withSession(null);
    await open();
    expect((await screen.findByTestId('expired')).textContent).toMatch(
      'Sesi di AEON BSD berakhir otomatis pukul 19:01. 4 label tersimpan.',
    );
    expect(screen.getByRole('link', { name: 'Mulai sesi baru' }).getAttribute('href')).toBe('/lokasi?mode=sesi');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tutup' }));
    await waitFor(() => expect(screen.queryByTestId('expired')).toBeNull());
    expect(await readPref(ID.user, PREF_KEYS.lastSession, null)).toBeNull();
  });

  it('kedaluwarsa saat layar terbuka: sesi di cache lewat expires_at → keadaan kedaluwarsa tanpa muat ulang', async () => {
    const s = fx<ActiveSession>('session_start');
    clockAt(s.session.expires_at, -1000);
    withSession('session_start');
    await open();
    expect(await screen.findByRole('heading', { name: 'Belanja di AEON BSD' })).toBeTruthy();
    clockAt(s.session.expires_at, 20_000);
    // Ketukan jam berikutnya (≤ 15 dtk) — dipicu langsung lewat fokus ulang.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 16_000));
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sesi belanja');
  }, 30_000);

  it('offline: sesi dari cache + foto di HP "menunggu sinyal"', async () => {
    const s = fx<ActiveSession>('session_start');
    clockAt(s.session.started_at, 10 * MIN);
    withSession('session_start');
    await OutboxStore.forUser(ID.user).add(
      newItem({
        capture_id: 'c1000000-0000-0000-0000-000000000009',
        kind: 'price_label',
        household_id: null,
        shopping_session_id: s.session.id,
        store_id: null,
        branch_id: null,
        captured_at: null,
        parts: [{ position: 1, ext: 'jpg', content_type: 'image/jpeg', sha256: 'b'.repeat(64), byte_size: 3 }],
      }),
      new Map([[1, new Blob(['abc'], { type: 'image/jpeg' })]]),
    );
    setOnline(false);
    await open();
    expect(await screen.findByText('Label di sesi ini (1)')).toBeTruthy();
    expect((await screen.findByTestId('session-label-local')).textContent).toBe('Foto labelmenunggu sinyal');
    expect(screen.getByText(/Sesi dari data tersimpan/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Akhiri sesi' })).toHaveProperty('disabled', true);
  });
});

describe('SessionBanner (U-13)', () => {
  it('tanpa sesi: tidak tampil', async () => {
    await renderWithProviders(<SessionBanner />);
    await waitFor(() => expect(rpcCalls('get_active_session').length).toBeGreaterThan(0));
    expect(document.querySelector('[data-session-banner]')).toBeNull();
  });

  it('"● Belanja di AEON BSD · 1j 12m · 4 label [Foto label]" + sesi diingat (D-43)', async () => {
    const s = fx<ActiveSession>('session_labels');
    clockAt(s.session.started_at, 72 * MIN);
    withSession('session_labels');
    await renderWithProviders(<SessionBanner />);
    const banner = await screen.findByRole('region', { name: 'Belanja di AEON BSD' });
    expect(banner.textContent).toBe('Belanja di AEON BSD · 1j 12m · 4 labelFoto label');
    expect(
      within(banner)
        .getByRole('link', { name: /Buka sesi belanja di AEON BSD, berjalan 1j 12m, 4 label/ })
        .getAttribute('href'),
    ).toBe('/belanja');
    expect(within(banner).getByRole('link', { name: 'Foto label' }).getAttribute('href')).toBe('/kamera?jenis=label');
    await waitFor(async () =>
      expect(await readPref(ID.user, PREF_KEYS.lastSession, null)).toEqual({
        id: s.session.id,
        place: 'AEON BSD',
        expires_at: s.session.expires_at,
        label_count: 4,
      }),
    );
  });

  it('sesi kedaluwarsa hilang tanpa muat ulang', async () => {
    const s = fx<ActiveSession>('session_start');
    clockAt(s.session.expires_at, -2000);
    withSession('session_start');
    await renderWithProviders(<SessionBanner />);
    expect(await screen.findByRole('region', { name: 'Belanja di AEON BSD' })).toBeTruthy();
    clockAt(s.session.expires_at, 1000);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15_500));
    });
    expect(document.querySelector('[data-session-banner]')).toBeNull();
  }, 30_000);
});

describe('S-06 dengan sesi aktif (U-08)', () => {
  it('Label di urutan pertama, terpilih, + "Label harga akan masuk ke AEON BSD" → kamera label', async () => {
    const s = fx<ActiveSession>('session_start');
    clockAt(s.session.started_at, MIN);
    withSession('session_start');
    setUrl('/', 'sheet=foto');
    await renderWithProviders(<PhotoSheet />);
    const dialog = await screen.findByRole('dialog', { name: 'Foto apa?' });
    await waitFor(() =>
      expect(
        within(dialog)
          .getAllByText(/^(Struk|Label harga|Screenshot marketplace|Pilih dari galeri)$/)
          .map((e) => e.textContent),
      ).toEqual(['Label harga', 'Struk', 'Screenshot marketplace', 'Pilih dari galeri']),
    );
    const label = within(dialog).getByRole('button', { name: /Label harga/ });
    expect(label.textContent).toMatch('Label harga akan masuk ke AEON BSD');
    expect(label.getAttribute('aria-current')).toBe('true');
    await userEvent.setup().click(label);
    expect(nav.replace).toHaveBeenCalledWith('/kamera?jenis=label');
  });
});

describe('Sesi yang diingat (D-43, F-62)', () => {
  it('R18 tanpa sesi sebelum expires_at yang diingat (diakhiri di perangkat lain) → dilupakan', async () => {
    const s = fx<ActiveSession>('session_start');
    await writePref(ID.user, PREF_KEYS.lastSession, {
      id: s.session.id,
      place: 'AEON BSD',
      expires_at: s.session.expires_at,
      label_count: 2,
    });
    clockAt(s.session.started_at, 30 * MIN);
    withSession(null);
    await renderWithProviders(<SessionBanner />);
    await waitFor(async () => expect(await readPref(ID.user, PREF_KEYS.lastSession, 'x')).toBe('x'));
  });
});
