// @vitest-environment jsdom
// L5b M6: S-19 Saya (ringkasan, nama, Keluar + peringatan antrean Q-61), S-19b (W16, program
// dihentikan, INVALID_STATE), S-19c (W14 nyala/mati + konfirmasi, W15), Privasi & hapus akun (OTP ulang
// → HAPUS AKUN → ConfirmTwice → route), S-00b/S-00c (onboarding), S-15 edit barcode (D-89). Keluaran
// R1/R21/W14/W15/W16/REST profile + barcode_assignment ASLI (test/fixtures/rpc.json).
import '../m1/mocks';
import type { MyContext, MyProgram } from '@priceatlas/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAT,
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

const { MeScreen } = await import('@/features/me/me-screen');
const { MemberScreen } = await import('@/features/me/member-screen');
const { ShareScreen } = await import('@/features/me/share-screen');
const { PrivacyScreen } = await import('@/features/me/privacy-screen');
const { WelcomeScreen } = await import('@/features/onboarding/welcome-screen');
const { MemberStepScreen } = await import('@/features/onboarding/member-step-screen');
const { EditProductScreen } = await import('@/features/catalog/edit-product-screen');
const { readPref, writePref, PREF_KEYS } = await import('@/lib/offline/prefs');
const { OutboxStore, newItem } = await import('@/lib/offline/outbox-store');

installDomPolyfills();

const AEON = '40000000-0000-0000-0000-000000000001';
const OLD = '40000000-0000-0000-0000-000000000003';
const err = (key: string) => ({ data: null, error: fx<{ error: unknown }>(key).error });
const rpcCalls = (name: string) => sb.rpc.mock.calls.filter(([fn]) => fn === name);
const restOf = (table: string, method: string) =>
  state.restCalls.filter((c) => c.table === table && c.calls.some(([m]) => m === method));
const sharedContext = (): MyContext => {
  const c = fx<MyContext>('context');
  return { ...c, household: { ...c.household, share_prices_public: true } };
};

beforeEach(async () => {
  await resetHarness();
  freezeToday();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('S-19 Saya', () => {
  it('ringkasan program (R21) dan status berbagi (R1), tautan ke S-19b/S-19c/Privasi', async () => {
    state.rpcOverride = (fn) => (fn === 'get_my_programs' ? { data: fx('programs_member'), error: null } : undefined);
    await renderWithProviders(<MeScreen />);
    expect(await screen.findByText('1 diikuti: AEON Member')).toBeTruthy();
    expect(screen.getByTestId('me-share').textContent).toContain('Mati');
    expect(screen.getByTestId('me-member').getAttribute('href')).toBe('/saya/member');
    expect(screen.getByTestId('me-share').getAttribute('href')).toBe('/saya/berbagi');
    expect(screen.getByTestId('me-privacy').getAttribute('href')).toBe('/saya/privasi');
    expect(screen.getByText('Foto struk dihapus otomatis setelah 12 bulan. Data harga tetap ada.')).toBeTruthy();
    expect(screen.getByTestId('signed-in-as').textContent).toContain('ani@example.com');
  });

  it('ubah nama → REST PATCH profile (display_name, filter user) → R1 dimuat ulang', async () => {
    await renderWithProviders(<MeScreen />);
    const user = userEvent.setup();
    expect((await screen.findByTestId('display-name')).textContent).toContain('ani');
    await user.click(screen.getByRole('button', { name: 'Ubah nama' }));
    const input = screen.getByLabelText('Nama tampilan');
    await user.clear(input);
    await user.type(input, '  Ani Rahma ');
    const before = rpcCalls('get_my_context').length;
    await user.click(screen.getByRole('button', { name: 'Simpan nama' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Nama disimpan.'));
    const patch = restOf('profile', 'update')[0]!;
    expect(patch.calls).toContainEqual(['update', [{ display_name: 'Ani Rahma' }]]);
    expect(patch.calls).toContainEqual(['eq', ['user_id', ID.user]]);
    await waitFor(() => expect(rpcCalls('get_my_context').length).toBeGreaterThan(before));
  });

  it('nama > 50 huruf ditolak di klien', async () => {
    await renderWithProviders(<MeScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ubah nama' }));
    const input = screen.getByLabelText('Nama tampilan');
    await user.clear(input);
    await user.type(input, 'x'.repeat(51));
    await user.click(screen.getByRole('button', { name: 'Simpan nama' }));
    expect(screen.getByRole('alert').textContent).toBe('Nama maksimal 50 huruf.');
    expect(restOf('profile', 'update')).toHaveLength(0);
  });

  it('Keluar tanpa antrean: langsung signOut + data lokal dihapus → /masuk', async () => {
    await writePref(ID.user, PREF_KEYS.onboarded, true);
    await renderWithProviders(<MeScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Keluar' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/masuk'));
    expect(sb.auth.signOut).toHaveBeenCalled();
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain(`priceatlas:${ID.user}`);
    // Komponen yang masih terpasang tidak bisa membuat ulang database setelah Keluar (F-81).
    expect(await readPref(ID.user, PREF_KEYS.onboarded, false)).toBe(false);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(`priceatlas:${ID.user}`);
  });

  it('Keluar dengan antrean belum kosong → peringatan jumlah foto (Q-61); Batal tidak keluar', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const part = { position: 1, ext: 'jpg', content_type: 'image/jpeg', sha256: 'a', byte_size: 1 } as const;
    await OutboxStore.forUser(ID.user).add(
      newItem({
        capture_id: '11111111-0000-0000-0000-000000000001',
        kind: 'receipt',
        household_id: null,
        shopping_session_id: null,
        store_id: null,
        branch_id: null,
        captured_at: null,
        parts: [part, { ...part, position: 2 }],
      }),
      new Map(),
    );
    await renderWithProviders(<MeScreen />);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Keluar' });
    await waitFor(async () => {
      await user.click(button);
      expect(screen.getByTestId('signout-warning').textContent).toBe(
        '2 foto belum terunggah dan akan dihapus. Tetap keluar?',
      );
    });
    await user.click(screen.getByRole('button', { name: 'Batal' }));
    expect(sb.auth.signOut).not.toHaveBeenCalled();
    await user.click(button);
    await user.click(await screen.findByRole('button', { name: 'Tetap keluar' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/masuk'));
    // Offline: signOut global gagal → sesi lokal tetap dihapus.
    expect(sb.auth.signOut).toHaveBeenCalled();
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(`priceatlas:${ID.user}`);
  });

  it('signOut global gagal (offline) → signOut scope local', async () => {
    sb.auth.signOut.mockImplementationOnce(async () => ({ error: new TypeError('Failed to fetch') }));
    await renderWithProviders(<MeScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Keluar' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/masuk'));
    expect(sb.auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
  });
});

describe('S-19b Program member', () => {
  it('kalimat D-27/D-41, daftar per toko, program dihentikan nonaktif + label', async () => {
    await renderWithProviders(<MemberScreen />);
    expect(await screen.findByTestId('program-list')).toBeTruthy();
    expect(screen.getByTestId('member-intro').textContent).toContain(
      'Menandai sekarang tidak mengubah harga yang sudah tercatat.',
    );
    const old = screen.getByTestId(`program-${OLD}`);
    expect(old.textContent).toContain('program dihentikan');
    expect(within(old).getByRole('switch').hasAttribute('disabled')).toBe(true);
    expect(
      within(screen.getByTestId(`program-${AEON}`))
        .getByRole('switch')
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByRole('region', { name: 'AEON' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Alfamart' })).toBeTruthy();
  });

  it('toggle → W16 (p_member) tanpa optimistic → R21 dan R1 dimuat ulang', async () => {
    let member = false;
    state.rpcOverride = (fn, a) => {
      if (fn === 'set_program_membership') member = a.p_member as boolean;
      if (fn === 'get_my_programs')
        return {
          data: fx<MyProgram[]>('programs').map((p) => (p.program_id === AEON ? { ...p, is_member: member } : p)),
          error: null,
        };
      return undefined;
    };
    const { qc } = await renderWithProviders(<MemberScreen />);
    const ctxKey = ['rpc', 'get_my_context', {}];
    qc.setQueryData(ctxKey, fx('context'));
    const user = userEvent.setup();
    const sw = within(await screen.findByTestId(`program-${AEON}`)).getByRole('switch');
    await user.click(sw);
    expect(rpcCalls('set_program_membership')[0]![1]).toEqual({ p_program_id: AEON, p_member: true });
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(toast.success).toHaveBeenCalledWith('Kamu member AEON Member.');
    // R1 (program_ids) diinvalidasi (§4.3: W16).
    expect(qc.getQueryState(ctxKey)?.isInvalidated).toBe(true);
    await user.click(sw);
    expect(rpcCalls('set_program_membership')[1]![1]).toEqual({ p_program_id: AEON, p_member: false });
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
  });

  it('program dihentikan yang masih diikuti boleh dilepas; INVALID_STATE → pesan §8.2', async () => {
    state.rpcOverride = (fn) => {
      if (fn === 'get_my_programs')
        return {
          data: fx<MyProgram[]>('programs').map((p) => (p.program_id === OLD ? { ...p, is_member: true } : p)),
          error: null,
        };
      if (fn === 'set_program_membership') return err('member_discontinued');
      return undefined;
    };
    await renderWithProviders(<MemberScreen />);
    const user = userEvent.setup();
    const sw = within(await screen.findByTestId(`program-${OLD}`)).getByRole('switch');
    expect(sw.hasAttribute('disabled')).toBe(false);
    await user.click(sw);
    expect((await screen.findByTestId('member-error')).textContent).toBe(
      'Program ini sudah dihentikan dan tidak bisa ditandai.',
    );
  });

  it('katalog tanpa program → "Program belum ada di katalog."', async () => {
    state.rpcOverride = (fn) => (fn === 'get_my_programs' ? { data: [], error: null } : undefined);
    await renderWithProviders(<MemberScreen />);
    expect(await screen.findByText('Program belum ada di katalog.')).toBeTruthy();
  });
});

describe('S-19c Berbagi publik', () => {
  it('default mati + penjelasan; nyalakan → W14(true) langsung, R1 dimuat ulang', async () => {
    let on = false;
    state.rpcOverride = (fn, a) => {
      if (fn === 'set_share_prices_public') on = a.p_enabled as boolean;
      if (fn === 'get_my_context') return { data: on ? sharedContext() : fx('context'), error: null };
      return undefined;
    };
    await renderWithProviders(<ShareScreen />);
    const user = userEvent.setup();
    const sw = await screen.findByRole('switch', { name: /Bagikan harga secara anonim/ });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Identitasmu dan rumah tanggamu')).toBeTruthy();
    expect(screen.queryByTestId('share-existing')).toBeNull();
    await user.click(sw);
    expect(rpcCalls('set_share_prices_public')[0]![1]).toEqual({ p_enabled: true });
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByTestId('share-state').textContent).toBe('Harga baru akan dibagikan.');
  });

  it('"Bagikan juga data lama" → W15 → jumlah dari eligible_count', async () => {
    state.rpcOverride = (fn) => (fn === 'get_my_context' ? { data: sharedContext(), error: null } : undefined);
    await renderWithProviders(<ShareScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('share-existing'));
    expect((await screen.findByTestId('share-queued')).textContent).toBe(
      'Hingga 6 harga lama akan dibagikan bertahap. Hanya produk dan toko katalog umum yang dibagikan.',
    );
    expect(rpcCalls('share_existing_prices')).toHaveLength(1);
  });

  it('W15 INVALID_STATE → pesan S-19c', async () => {
    state.rpcOverride = (fn) => {
      if (fn === 'get_my_context') return { data: sharedContext(), error: null };
      if (fn === 'share_existing_prices') return err('share_existing_off');
      return undefined;
    };
    await renderWithProviders(<ShareScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('share-existing'));
    expect((await screen.findByTestId('share-error')).textContent).toBe(
      'Nyalakan berbagi harga dulu sebelum membagikan data lama.',
    );
  });

  it('mematikan → dialog konfirmasi; Batal tidak memanggil W14; Matikan → withdrawn_count', async () => {
    state.rpcOverride = (fn) => (fn === 'get_my_context' ? { data: sharedContext(), error: null } : undefined);
    await renderWithProviders(<ShareScreen />);
    const user = userEvent.setup();
    const sw = await screen.findByRole('switch', { name: /Bagikan harga secara anonim/ });
    await user.click(sw);
    expect(await screen.findByText('Harga yang sudah dibagikan akan ditarik dari data publik.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Batal' }));
    expect(rpcCalls('set_share_prices_public')).toHaveLength(0);
    await user.click(sw);
    await user.click(await screen.findByTestId('share-off-confirm'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Berbagi dimatikan. 6 harga ditarik dari data publik.'),
    );
    expect(rpcCalls('set_share_prices_public')[0]![1]).toEqual({ p_enabled: false });
  });
});

describe('Privasi & hapus akun (D-76)', () => {
  function stubDelete(...responses: [number, unknown][]) {
    const f = vi.fn(async () => {
      const [status, body] = responses.length > 1 ? responses.shift()! : responses[0]!;
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', f);
    return f;
  }

  async function reauthAndType(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Kirim kode' }));
    expect(sb.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ani@example.com',
      options: { shouldCreateUser: false },
    });
    await user.type(await screen.findByLabelText('Kode 6 angka'), '123456');
    await user.click(screen.getByRole('button', { name: 'Periksa kode' }));
    expect(sb.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ani@example.com', token: '123456', type: 'email' });
    await user.type(await screen.findByLabelText('Ketik HAPUS AKUN'), 'HAPUS AKUN');
  }

  it('retensi 12 bulan; OTP ulang → HAPUS AKUN → tekan dua kali → 202 → keluar + data lokal dihapus', async () => {
    const f = stubDelete([202, { status: 'accepted' }]);
    await renderWithProviders(<PrivacyScreen />);
    const user = userEvent.setup();
    expect(screen.getByText('Foto struk dihapus otomatis setelah 12 bulan.')).toBeTruthy();
    // Q-114: pemroses AI disebut (Anthropic), juga untuk Tanya.
    expect(screen.getByRole('heading', { name: 'Pembacaan oleh AI' })).toBeTruthy();
    expect(screen.getByText(/dikirim ke layanan AI Anthropic \(Claude\)/)).toBeTruthy();
    expect(screen.getByText(/Pertanyaan di Tanya/)).toBeTruthy();
    await reauthAndType(user);
    const del = screen.getByTestId('delete-account');
    await user.click(del);
    expect(del.getAttribute('data-armed')).toBe('true');
    expect(f).not.toHaveBeenCalled();
    await user.click(del);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/masuk'));
    expect(f).toHaveBeenCalledWith(
      '/api/account/delete',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: 'HAPUS AKUN' }) }),
    );
    expect(sb.auth.signOut).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Akun dihapus. Data dihapus bertahap di latar belakang.');
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(`priceatlas:${ID.user}`);
  });

  it('tombol hapus nonaktif sampai teks persis HAPUS AKUN', async () => {
    stubDelete([202, {}]);
    await renderWithProviders(<PrivacyScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Kirim kode' }));
    await user.type(await screen.findByLabelText('Kode 6 angka'), '123456');
    await user.click(screen.getByRole('button', { name: 'Periksa kode' }));
    await user.type(await screen.findByLabelText('Ketik HAPUS AKUN'), 'hapus akun');
    expect(screen.getByTestId('delete-account').hasAttribute('disabled')).toBe(true);
  });

  it('kode salah → pesan, tetap di langkah kode', async () => {
    sb.auth.verifyOtp.mockImplementationOnce(async () => ({
      data: {},
      error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' },
    }));
    await renderWithProviders(<PrivacyScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Kirim kode' }));
    await user.type(await screen.findByLabelText('Kode 6 angka'), '000000');
    await user.click(screen.getByRole('button', { name: 'Periksa kode' }));
    expect((await screen.findByTestId('delete-error')).textContent).toBe('Kode salah. Periksa 6 angka di emailmu.');
    expect(screen.queryByLabelText('Ketik HAPUS AKUN')).toBeNull();
  });

  it('REAUTH_REQUIRED → kembali ke langkah login ulang dengan pesan §8.2', async () => {
    stubDelete([401, { error: 'REAUTH_REQUIRED', message: 'x' }]);
    await renderWithProviders(<PrivacyScreen />);
    const user = userEvent.setup();
    await reauthAndType(user);
    await user.click(screen.getByTestId('delete-account'));
    await user.click(screen.getByTestId('delete-account'));
    expect((await screen.findByTestId('delete-error')).textContent).toBe(
      'Untuk menghapus akun, masuk ulang dulu (kode dikirim ke emailmu), lalu ketik HAPUS AKUN.',
    );
    expect(screen.getByRole('button', { name: 'Kirim kode' })).toBeTruthy();
    expect(sb.auth.signOut).not.toHaveBeenCalled();
  });

  it('DELETE_INCOMPLETE → "Coba lagi" (tombol kembali ke awal), ulang → 202', async () => {
    const f = stubDelete([500, { error: 'DELETE_INCOMPLETE' }], [202, { status: 'accepted' }]);
    await renderWithProviders(<PrivacyScreen />);
    const user = userEvent.setup();
    await reauthAndType(user);
    const del = screen.getByTestId('delete-account');
    await user.click(del);
    await user.click(del);
    expect((await screen.findByTestId('delete-error')).textContent).toBe('Penghapusan belum selesai. Coba lagi.');
    expect(del.getAttribute('data-armed')).toBe('false');
    await user.click(del);
    await user.click(del);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/masuk'));
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('Onboarding S-00b → S-00c', () => {
  it('S-00b: nilai produk; Lewati → status disimpan → tujuan ?next', async () => {
    setUrl('/selamat-datang', 'next=/unggahan');
    await renderWithProviders(<WelcomeScreen />);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Murah atau mahal? Cek dulu sebelum beli.' })).toBeTruthy();
    expect(screen.getByText('Bukan aplikasi pencatat pengeluaran. Data harga privat secara default.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Lewati' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/unggahan'));
    expect(await readPref(ID.user, PREF_KEYS.onboarded, false)).toBe(true);
  });

  it('S-00b: Mulai → S-00c dengan tujuan yang sama', async () => {
    setUrl('/selamat-datang', 'next=/unggahan');
    await renderWithProviders(<WelcomeScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mulai' }));
    expect(nav.push).toHaveBeenCalledWith('/selamat-datang/member?next=%2Funggahan');
  });

  it('sudah onboarded di perangkat ini → langsung diteruskan, layar tidak tampil', async () => {
    await writePref(ID.user, PREF_KEYS.onboarded, true);
    setUrl('/selamat-datang', 'next=/saya');
    await renderWithProviders(<WelcomeScreen />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/saya'));
    expect(screen.queryByRole('button', { name: 'Mulai' })).toBeNull();
  });

  it('S-00c: pilih program → Simpan & lanjut → W16 per program → S-01; program dihentikan tidak bisa dipilih', async () => {
    setUrl('/selamat-datang/member');
    await renderWithProviders(<MemberStepScreen />);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Kamu member di mana?' })).toBeTruthy();
    expect(
      within(await screen.findByTestId(`program-${OLD}`))
        .getByRole('switch')
        .hasAttribute('disabled'),
    ).toBe(true);
    await user.click(within(screen.getByTestId(`program-${AEON}`)).getByRole('switch'));
    expect(rpcCalls('set_program_membership')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Simpan & lanjut' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'));
    expect(rpcCalls('set_program_membership').map(([, a]) => a)).toEqual([{ p_program_id: AEON, p_member: true }]);
    expect(await readPref(ID.user, PREF_KEYS.onboarded, false)).toBe(true);
  });

  it('S-00c: Lewati → tanpa W16, status disimpan', async () => {
    setUrl('/selamat-datang/member', 'next=/belanja');
    await renderWithProviders(<MemberStepScreen />);
    const user = userEvent.setup();
    await screen.findByTestId('program-list');
    await user.click(screen.getByRole('button', { name: 'Lewati' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/belanja'));
    expect(rpcCalls('set_program_membership')).toHaveLength(0);
  });
});

describe('S-15 edit: barcode & PLU (D-89)', () => {
  it('daftar REST barcode_assignment produk ini; tambah GTIN → insert dengan id klien', async () => {
    setUrl('/produk/edit', `id=${CAT.syrup}`);
    await renderWithProviders(<EditProductScreen />);
    const user = userEvent.setup();
    const section = await screen.findByTestId('barcodes');
    expect((await within(section).findByTestId('barcode-list')).textContent).toContain('2001');
    expect(restOf('barcode_assignment', 'select')[0]!.calls).toContainEqual(['eq', ['product_id', CAT.syrup]]);
    // Produk per kemasan: hanya GTIN (PLU untuk produk timbang).
    expect(within(section).queryByLabelText('Jenis kode')).toBeNull();
    await user.type(within(section).getByLabelText('Kode baru'), '123');
    await user.click(within(section).getByTestId('barcode-add'));
    expect(await within(section).findByText('Barcode berisi 8–14 angka.')).toBeTruthy();
    await user.clear(within(section).getByLabelText('Kode baru'));
    await user.type(within(section).getByLabelText('Kode baru'), '8991234500017');
    await user.click(within(section).getByTestId('barcode-add'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Kode 8991234500017 ditambahkan.'));
    const row = restOf('barcode_assignment', 'insert')[0]!.calls.find(([m]) => m === 'insert')![1][0] as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({ product_id: CAT.syrup, code: '8991234500017', code_type: 'gtin', store_id: null });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    // Form produk tidak ikut berubah (tidak ada PATCH product).
    expect(restOf('product', 'update')).toHaveLength(0);
  });

  it('23P01 (dipakai produk lain) → pesan di field kode', async () => {
    state.rest.barcode_assignment = (c) =>
      c.calls.some(([m]) => m === 'insert') ? err('barcode_insert_23P01') : { data: [], error: null };
    setUrl('/produk/edit', `id=${CAT.syrup}`);
    await renderWithProviders(<EditProductScreen />);
    const user = userEvent.setup();
    const section = await screen.findByTestId('barcodes');
    expect(await within(section).findByText('Belum ada barcode atau PLU untuk produk ini.')).toBeTruthy();
    await user.type(within(section).getByLabelText('Kode baru'), '8991234500017');
    await user.click(within(section).getByTestId('barcode-add'));
    expect(
      await within(section).findByText('Barcode ini sudah dipakai produk lain di periode yang sama.'),
    ).toBeTruthy();
  });
});
