// @vitest-environment jsdom
// L5b M2: S-08 Unggahan dan S-09 Detail unggahan di setiap keadaan §7.3, memakai keluaran R13/R14
// ASLI (test/fixtures/rpc.json, capture Citra di semua status lewat pipeline worker).
import '../m1/mocks';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureIds,
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

const { UploadsScreen } = await import('@/features/uploads/uploads-screen');
const { UploadDetailScreen } = await import('@/features/uploads/upload-detail-screen');
const { UploadWatcher } = await import('@/features/uploads/upload-watcher');
const { TabBar } = await import('@/components/app/tab-bar');
const { OutboxStore, newItem } = await import('@/lib/offline/outbox-store');
const { pollInterval, POLL_MS } = await import('@/lib/data/captures');

installDomPolyfills();

type Item = { id: string; status: string; kind: string };
const err = (key: string) => ({ data: null, error: fx<{ error: unknown }>(key).error });

beforeEach(async () => {
  await resetHarness();
  setUrl('/unggahan');
});

async function addLocal(over: Record<string, unknown> = {}) {
  const item = {
    ...newItem({
      capture_id: '44444444-4444-4444-8444-444444444444',
      kind: 'receipt',
      household_id: null,
      shopping_session_id: null,
      store_id: null,
      branch_id: null,
      captured_at: null,
      parts: [
        { position: 1, ext: 'jpg', content_type: 'image/jpeg', sha256: 'a'.repeat(64), byte_size: 1000 },
        { position: 2, ext: 'jpg', content_type: 'image/jpeg', sha256: 'b'.repeat(64), byte_size: 1000 },
      ],
    }),
    ...over,
  };
  await OutboxStore.forUser(ID.user).add(
    item as never,
    new Map([
      [1, new Blob(['x'])],
      [2, new Blob(['y'])],
    ]),
  );
  return item;
}

describe('S-08 Unggahan', () => {
  it('normal: Perlu dicek di atas, Sedang diproses, Selesai, Gagal — teks per status (wireframe S-08)', async () => {
    await renderWithProviders(<UploadsScreen />);
    const needs = await screen.findByRole('region', { name: 'Perlu dicek (1)' });
    expect(within(needs).getByText('2 item perlu dicek')).toBeTruthy();
    expect(within(needs).getByText(/^AEON · AEON BSD · /)).toBeTruthy();
    const proc = screen.getByRole('region', { name: 'Sedang diproses (2)' });
    expect(within(proc).getByText('Diproses…')).toBeTruthy();
    expect(within(proc).getByText('Menunggu antrean')).toBeTruthy();
    expect(within(proc).getAllByText(/^diunggah /)).toHaveLength(2);
    const done = screen.getByRole('region', { name: 'Selesai' });
    expect(within(done).getByText('1 harga tersimpan')).toBeTruthy();
    expect(within(done).getByText(/^Alfamart · Alfamart Serpong · /)).toBeTruthy();
    const failed = screen.getByRole('region', { name: 'Gagal (1)' });
    expect(within(failed).getByText('Gambar buram atau terpotong.')).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Perlu dicek (1)', 'Sedang diproses (2)', 'Selesai', 'Gagal (1)']);
    expect(within(needs).getByRole('link').getAttribute('href')).toBe(`/unggahan/detail?id=${captureIds().needs}`);
    expect(sb.rpc).toHaveBeenCalledWith('list_captures', { p_limit: 50, p_kind: null });
  });

  it('Gagal: "Ulangi" (W2) → retry_capture + toast; INVALID_TRANSITION → pesan §8.2', async () => {
    await renderWithProviders(<UploadsScreen />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Ulangi' }));
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('retry_capture', { p_capture_id: captureIds().failed }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Unggahan diulang. Kami kabari hasilnya.'));
    state.rpcOverride = (fn) => (fn === 'retry_capture' ? err('retry_not_failed') : undefined);
    await u.click(screen.getByRole('button', { name: 'Ulangi' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Unggahan ini tidak sedang gagal, jadi tidak perlu diulang.'),
    );
  });

  it('kosong: "Belum ada unggahan…" + tombol kamera', async () => {
    state.rpcOverride = (fn) => (fn === 'list_captures' ? { data: fx('captures_empty'), error: null } : undefined);
    await renderWithProviders(<UploadsScreen />);
    expect(
      await screen.findByText('Belum ada unggahan. Foto struk pertamamu untuk mulai mengisi histori.'),
    ).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Foto struk' }));
    expect(nav.push).toHaveBeenCalledWith('/unggahan?sheet=foto', { scroll: false });
  });

  it('semua beres: bagian Perlu dicek hilang, "Semua sudah dicek"', async () => {
    const all = fx<Item[]>('captures_all').filter((c) => c.status !== 'needs_confirmation');
    state.rpcOverride = (fn) => (fn === 'list_captures' ? { data: all, error: null } : undefined);
    await renderWithProviders(<UploadsScreen />);
    expect(await screen.findByTestId('all-checked')).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Perlu dicek/ })).toBeNull();
  });

  it('filter jenis: Struk → ?jenis=struk; dari URL → R13 p_kind receipt', async () => {
    const view = await renderWithProviders(<UploadsScreen />);
    await screen.findByRole('region', { name: 'Perlu dicek (1)' });
    await userEvent.setup().click(screen.getByText('Struk', { selector: 'label' }));
    expect(nav.replace).toHaveBeenCalledWith('/unggahan?jenis=struk', { scroll: false });
    view.unmount();
    setUrl('/unggahan', 'jenis=struk');
    await renderWithProviders(<UploadsScreen />);
    await screen.findByRole('region', { name: 'Gagal (1)' });
    expect(sb.rpc).toHaveBeenCalledWith('list_captures', { p_limit: 50, p_kind: 'receipt' });
    expect(screen.queryByRole('region', { name: /Sedang diproses/ })).toBeNull();
  });

  it('memuat: skeleton; gagal: pesan + Coba lagi', async () => {
    state.rpcOverride = (fn) => (fn === 'list_captures' ? new Promise(() => undefined) : undefined);
    const view = await renderWithProviders(<UploadsScreen />);
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    view.unmount();
    state.rpcOverride = (fn) => (fn === 'list_captures' ? Promise.reject(new TypeError('Failed to fetch')) : undefined);
    await renderWithProviders(<UploadsScreen />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Tidak ada sinyal/);
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });

  it('Menunggu sinyal (offline): item lokal di paling atas dengan status; Hapus (lokal) minta konfirmasi', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addLocal({ state: 'waiting_network', attempts: 1 });
    await renderWithProviders(<UploadsScreen />);
    const local = await screen.findByRole('region', { name: 'Menunggu sinyal (1)' });
    expect(within(local).getByText('Menunggu sinyal')).toBeTruthy();
    expect(within(local).getByText('2 bagian')).toBeTruthy();
    const u = userEvent.setup();
    await u.click(within(local).getByRole('button', { name: 'Hapus' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hapus foto ini dari HP?' });
    await u.click(within(dialog).getByRole('button', { name: 'Hapus' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Menunggu sinyal/ })).toBeNull());
    expect((await OutboxStore.forUser(ID.user).list()).items).toEqual([]);
  });

  it('antrean > 1 jam → "buka app untuk mengunggah" (§5.8); CAPTURE_IMAGES_MISSING → teks coba lagi otomatis', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addLocal({
      state: 'waiting_network',
      created_at: Date.now() - 2 * 60 * 60_000,
      last_error: { kind: 'missing', code: 'CAPTURE_IMAGES_MISSING', message: null },
    });
    await renderWithProviders(<UploadsScreen />);
    expect(await screen.findByText(/Buka app saat ada sinyal untuk mengunggah/)).toBeTruthy();
  });

  it('online: item lokal error → "Gagal diunggah" + Coba lagi; duplikat tertahan → Tetap unggah', async () => {
    await addLocal({ state: 'error', last_error: { kind: 'storage', code: '415', message: 'mime' } });
    await renderWithProviders(<UploadsScreen />);
    const local = await screen.findByRole('region', { name: 'Belum terunggah (1)' });
    expect(within(local).getByText('Gagal diunggah')).toBeTruthy();
    expect(within(local).getByText(/Foto terlalu besar atau formatnya tidak didukung/)).toBeTruthy();
    await userEvent.setup().click(within(local).getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect(state.storage.upload).toHaveBeenCalledTimes(2));
    // Tunggu antrean selesai supaya tidak ada proses yang tersisa ke test berikutnya.
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('submit_capture', expect.anything()));
  });

  it('duplikat tertahan (cek tertunda saat offline): teks + Tetap unggah', async () => {
    await addLocal({
      duplicate: {
        status: 'found',
        matches: [{ capture_id: '22222222-2222-4222-8222-222222222222', created_at: '2026-10-12T05:00:00Z' }],
      },
    });
    await renderWithProviders(<UploadsScreen />);
    expect(await screen.findByText('Foto ini sepertinya pernah diunggah (12 Okt 2026).')).toBeTruthy();
    expect(state.storage.upload).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tetap unggah' }));
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('submit_capture', expect.anything()));
  });
});

describe('polling R13 (D-61, P-15) dan badge', () => {
  it('5 dtk hanya jika ada uploaded/processing dan tab terlihat', () => {
    expect(pollInterval(['done', 'processing'])).toBe(POLL_MS);
    expect(pollInterval(['uploaded'])).toBe(5_000);
    expect(pollInterval(['done', 'failed', 'needs_confirmation'])).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    expect(pollInterval(['processing'])).toBe(false);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('badge tab Unggahan = jumlah needs_confirmation (REST head count)', async () => {
    state.rest.capture = () => ({ data: null, error: null, count: 3 });
    await renderWithProviders(<TabBar />);
    const badge = await screen.findByTestId('uploads-badge');
    expect(badge.textContent).toContain('3');
    expect(screen.getByRole('link', { name: /Unggahan, 3 perlu dicek/ })).toBeTruthy();
  });

  it('perubahan status penting diumumkan (aria-live + toast, U-11); muat pertama tidak', async () => {
    let list = fx<Item[]>('captures_all');
    state.rpcOverride = (fn) => (fn === 'list_captures' ? { data: list, error: null } : undefined);
    const view = await renderWithProviders(<UploadWatcher />);
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('list_captures', expect.anything()));
    expect(screen.getByTestId('upload-announcer').textContent).toBe('');
    list = list.map((c) => (c.status === 'processing' ? { ...c, status: 'failed', error_code: 'timeout' } : c));
    await act(() => view.qc.invalidateQueries({ queryKey: ['rpc', 'list_captures'] }));
    await waitFor(() =>
      expect(screen.getByTestId('upload-announcer').textContent).toBe(
        'Label harga gagal diproses: Pemrosesan terlalu lama. Coba ulangi.',
      ),
    );
    expect(toast).toHaveBeenCalledWith('Label harga gagal diproses: Pemrosesan terlalu lama. Coba ulangi.');
  });
});

describe('S-09 Detail unggahan', () => {
  const open = (key: string) => {
    setUrl('/unggahan/detail', `id=${captureIds()[key]}`);
    return renderWithProviders(<UploadDetailScreen />);
  };

  it('uploaded: "Menunggu antrean" + Hapus (W3) dengan konfirmasi → kembali ke S-08 + toast', async () => {
    await open('uploaded');
    expect(await screen.findByText('Menunggu antrean')).toBeTruthy();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Hapus' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hapus unggahan ini?' });
    await u.click(within(dialog).getByRole('button', { name: 'Hapus' }));
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('delete_capture', { p_capture_id: captureIds().uploaded }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/unggahan'));
    expect(toast.success).toHaveBeenCalledWith('Unggahan dihapus.');
  });

  it('Hapus ditolak INVALID_STATE → pesan S-09 §8.2', async () => {
    state.rpcOverride = (fn) => (fn === 'delete_capture' ? err('delete_not_allowed') : undefined);
    await open('uploaded');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Hapus' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Hapus' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unggahan yang sedang diproses atau sudah selesai tidak bisa dihapus.',
    );
  });

  it('processing: "Sedang dibaca…" + bilah tak tentu, tanpa aksi', async () => {
    await open('processing');
    expect(await screen.findByText('Sedang dibaca…')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Sedang dibaca' });
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
    expect(screen.getByTestId('timeline').textContent).toMatch(/Percobaan ke-1 · sedang dibaca/);
  });

  it('needs_confirmation: "Cek sekarang" nonaktif + pesan M3 (D-85), jumlah dari R13 di cache', async () => {
    const view = await open('needs');
    view.qc.setQueryData(['rpc', 'list_captures', { p_limit: 50, p_kind: null }], fx('captures_all'));
    expect(await screen.findByText('2 item perlu dicek')).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Cek sekarang' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText('Halaman konfirmasi dibuat di milestone berikutnya (M3).')).toBeTruthy();
  });

  it('gambar: signed URL 300 dtk dengan JWT user (bukan di-cache SW)', async () => {
    await open('needs');
    const img = (await screen.findByRole('img', { name: 'Foto bagian 1 dari 1' })) as HTMLImageElement;
    const path = fx<{ images: { storage_path: string }[] }>('capture_needs').images[0]!.storage_path;
    expect(state.storage.createSignedUrl).toHaveBeenCalledWith(path, 300);
    expect(img.src).toContain(`/object/sign/captures/${path}?expires=300`);
  });

  it('done: "1 harga tersimpan" + daftar ringkas (nama dari R4)', async () => {
    await open('done');
    expect(await screen.findByText('1 harga tersimpan')).toBeTruthy();
    const saved = await screen.findAllByTestId('saved-record');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.textContent).toContain('Rp3.400');
    expect(screen.getByTestId('timeline').textContent).toMatch(/Percobaan ke-3 · berhasil dibaca/);
  });

  it('failed (buram): alasan §8.3, percobaan ke-n; "Foto ulang" utama, Ulangi, Hapus', async () => {
    await open('failed');
    expect(await screen.findByText('Gambar buram atau terpotong.')).toBeTruthy();
    expect(screen.getByText('Percobaan ke-1')).toBeTruthy();
    const actions = ['Foto ulang', 'Ulangi', 'Hapus'].map((n) =>
      screen.getByRole(n === 'Foto ulang' ? 'link' : 'button', { name: n }),
    );
    expect(actions[0]!.getAttribute('href')).toBe('/kamera?jenis=struk');
    expect(actions[0]!.compareDocumentPosition(actions[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('failed: Ulangi ditolak INVALID_TRANSITION → pesan + muat ulang status', async () => {
    state.rpcOverride = (fn) => (fn === 'retry_capture' ? err('retry_not_failed') : undefined);
    await open('failed');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ulangi' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unggahan ini tidak sedang gagal, jadi tidak perlu diulang.',
    );
    await waitFor(() =>
      expect(sb.rpc.mock.calls.filter(([fn]) => fn === 'get_capture').length).toBeGreaterThanOrEqual(2),
    );
  });

  it('gambar dihapus retensi (purged_at, D-32)', async () => {
    state.rpcOverride = (fn) => (fn === 'get_capture' ? { data: fx('capture_purged'), error: null } : undefined);
    await open('done');
    expect((await screen.findByTestId('images-purged')).textContent).toBe(
      'Gambar dihapus setelah 12 bulan. Data harga tetap ada.',
    );
    expect(state.storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it('NOT_FOUND → "Data ini tidak ditemukan…" + kembali', async () => {
    setUrl('/unggahan/detail', `id=${ID.unknown}`);
    await renderWithProviders(<UploadDetailScreen />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Data ini tidak ditemukan. Mungkin sudah dihapus.');
    expect(screen.getByRole('link', { name: 'Kembali ke Unggahan' }).getAttribute('href')).toBe('/unggahan');
  });

  it('memuat: skeleton', async () => {
    state.rpcOverride = (fn) => (fn === 'get_capture' ? new Promise(() => undefined) : undefined);
    await open('done');
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
  });
});

it('tidak ada timer palsu yang tertinggal', () => {
  expect(vi.isFakeTimers()).toBe(false);
});
