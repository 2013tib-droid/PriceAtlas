// @vitest-environment jsdom
// L5b M4: kamera label S-07 `/kamera?jenis=label` (D-82, P-18, U-07): getUserMedia tiruan, jendela bidik
// tetap terbuka untuk foto berikutnya, indikator per foto, antrean dengan shopping_session_id sesi
// aktif saat foto diambil (P-11) → W1, izin ditolak / kamera tidak ada → galeri, lokasi manual (F-53,
// D-28), tanpa sesi → S-12 mode manual. Antrean memakai OutboxProvider asli di atas IndexedDB tiruan.
// Frame kamera di jsdom: canvas tidak ada, jadi frame tiruan = byte fixture label-milo (logika frame
// → canvas → JPEG diuji di test/m4/logic.test.ts dan L5c test/browser/frame.browser.test.ts).
import '../m1/mocks';
import type { ActiveSession } from '@priceatlas/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fx, ID, installDomPolyfills, nav, renderWithProviders, resetHarness, sb, setUrl, state } from '../m1/harness';

const LABEL = new Uint8Array(
  readFileSync(resolve(import.meta.dirname, '../../../worker/test/fixtures/label-milo.jpg')),
);

vi.mock('@/lib/media/frame', async (orig) => {
  const real = await orig<typeof import('@/lib/media/frame')>();
  return {
    ...real,
    // Frame tiruan: byte JPEG fixture → pipeline M2 asli (prepareImage) sebagai sumber kamera.
    prepareLabelFrame: vi.fn(async (_video: HTMLVideoElement, now = new Date()) => {
      const { prepareImage } = await import('@/lib/media/prepare');
      const file = new File([LABEL], 'label.jpg', { type: 'image/jpeg', lastModified: now.getTime() });
      return prepareImage(file, { kind: 'price_label', source: 'camera', now });
    }),
  };
});

const { LabelCamera } = await import('@/features/capture/label-camera');

installDomPolyfills();

const AEON_BSD = '30000000-0000-0000-0000-000000000001';
const submitted = () =>
  sb.rpc.mock.calls.filter(([fn]) => fn === 'submit_capture').map(([, a]) => a as Record<string, unknown>);
const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] } as unknown as MediaStream;
const getUserMedia = vi.fn<(c: MediaStreamConstraints) => Promise<MediaStream>>();

function withSession(key: string | null) {
  state.rpcOverride = (fn) => (fn === 'get_active_session' ? { data: key ? fx(key) : null, error: null } : undefined);
}

beforeEach(async () => {
  await resetHarness();
  getUserMedia.mockReset().mockResolvedValue(stream);
  track.stop.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  sessionStorage.setItem('priceatlas:last-app-path', '/produk?id=x');
});
afterEach(() => {
  vi.useRealTimers();
});

async function openWithSession() {
  const s = fx<ActiveSession>('session_start');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.parse(s.session.started_at) + 10 * 60_000));
  withSession('session_start');
  setUrl('/kamera', 'jenis=label');
  const view = await renderWithProviders(<LabelCamera />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ambil foto label' })).toHaveProperty('disabled', false),
  );
  return { s, view };
}

describe('Kamera label dengan sesi aktif', () => {
  it('jendela bidik kamera belakang; sasaran sesi ditampilkan', async () => {
    await openWithSession();
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Foto label');
    expect(screen.getByTestId('label-target').textContent).toBe('Label masuk ke AEON BSD (sesi belanja).');
  });

  it('shutter → antrean dengan shopping_session_id → W1; kamera tetap terbuka untuk foto berikutnya', async () => {
    const { s } = await openWithSession();
    const user = userEvent.setup();
    const shutter = screen.getByRole('button', { name: 'Ambil foto label' });
    await user.click(shutter);
    await waitFor(() => expect(submitted()).toHaveLength(1));
    expect(submitted()[0]).toMatchObject({
      p_kind: 'price_label',
      p_shopping_session_id: s.session.id,
      p_store_id: null,
      p_branch_id: null,
      p_images: [{ position: 1, ext: 'jpg', byte_size: LABEL.byteLength }],
    });
    expect(String(submitted()[0]!.p_captured_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/${submitted()[0]!.p_capture_id}/1\\.jpg$`)),
      expect.any(Blob),
      expect.objectContaining({ upsert: false }),
    );
    // Indikator per foto, tanpa meninggalkan kamera.
    expect(within(screen.getByTestId('label-shots')).getAllByTestId('label-shot')[0]!.textContent).toBe(
      'Label 1: tersimpan',
    );
    expect(screen.getByRole('status').textContent).toBe('Label 1 tersimpan. Foto label berikutnya.');
    expect(nav.replace).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();

    await user.click(shutter);
    await waitFor(() => expect(submitted()).toHaveLength(2));
    expect(submitted()[1]!.p_capture_id).not.toBe(submitted()[0]!.p_capture_id);
    expect(screen.getAllByTestId('label-shot')).toHaveLength(2);
  });

  it('Selesai → kembali ke layar sebelumnya + toast ringkas; kamera dimatikan', async () => {
    const { view } = await openWithSession();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ambil foto label' }));
    await waitFor(() => expect(screen.getByTestId('label-shot').textContent).toBe('Label 1: tersimpan'));
    await user.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(toast.success).toHaveBeenCalledWith('1 label diunggah. Kami kabari kalau perlu dicek.');
    expect(nav.replace).toHaveBeenCalledWith('/produk?id=x');
    view.unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('sesi berakhir di antara foto (D-43): label berikutnya tanpa sesi + pemberitahuan', async () => {
    const { s } = await openWithSession();
    vi.setSystemTime(new Date(Date.parse(s.session.expires_at) + 1000));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ambil foto label' }));
    await waitFor(() => expect(submitted()).toHaveLength(1));
    expect(submitted()[0]).toMatchObject({ p_shopping_session_id: null, p_store_id: null });
    expect(screen.getByRole('alert').textContent).toMatch(/Sesi belanja sudah berakhir/);
  });

  it('offline: label disimpan di HP (antrean), indikator "disimpan di HP"', async () => {
    await openWithSession();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ambil foto label' }));
    await waitFor(() => expect(screen.getByTestId('label-shot').textContent).toBe('Label 1: disimpan di HP'));
    expect(submitted()).toHaveLength(0);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
  });
});

describe('Kamera label: izin ditolak / tidak ada kamera → galeri', () => {
  it('NotAllowedError → pesan + "Pilih dari galeri" → label tersimpan dengan sesi', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const s = fx<ActiveSession>('session_start');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.parse(s.session.started_at) + 60_000));
    withSession('session_start');
    setUrl('/kamera', 'jenis=label');
    await renderWithProviders(<LabelCamera />);
    expect(await screen.findByText(/Izin kamera ditolak/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ambil foto label' })).toHaveProperty('disabled', true);
    await userEvent
      .setup()
      .upload(
        screen.getByTestId('label-gallery-fallback'),
        new File([LABEL], 'label-milo.jpg', { type: 'image/jpeg' }),
      );
    await waitFor(() => expect(submitted()).toHaveLength(1));
    expect(submitted()[0]).toMatchObject({ p_kind: 'price_label', p_shopping_session_id: s.session.id });
  });

  it('tanpa mediaDevices → "Kamera tidak bisa dibuka" + galeri', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    withSession('session_start');
    const s = fx<ActiveSession>('session_start');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.parse(s.session.started_at) + 60_000));
    setUrl('/kamera', 'jenis=label');
    await renderWithProviders(<LabelCamera />);
    expect(await screen.findByText(/Kamera tidak bisa dibuka/)).toBeTruthy();
    expect(screen.getByTestId('label-gallery-fallback')).toBeTruthy();
  });
});

describe('Kamera label tanpa sesi (F-53, D-28)', () => {
  it('tanpa sesi dan tanpa lokasi → S-12 mode manual', async () => {
    withSession(null);
    setUrl('/kamera', 'jenis=label');
    await renderWithProviders(<LabelCamera />);
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(
        `/lokasi?mode=manual&untuk=label&kembali=${encodeURIComponent('/kamera?jenis=label')}`,
      ),
    );
  });

  it('lokasi manual dari S-12 → W1 dengan store/branch capture, tanpa sesi', async () => {
    withSession(null);
    setUrl('/kamera', `jenis=label&toko=${ID.aeon}&cabang=${AEON_BSD}`);
    await renderWithProviders(<LabelCamera />);
    await waitFor(() => expect(screen.getByTestId('label-target').textContent).toBe('Label masuk ke AEON · AEON BSD.'));
    const shutter = screen.getByRole('button', { name: 'Ambil foto label' });
    await waitFor(() => expect(shutter).toHaveProperty('disabled', false));
    await userEvent.setup().click(shutter);
    await waitFor(() => expect(submitted()).toHaveLength(1));
    expect(submitted()[0]).toMatchObject({ p_shopping_session_id: null, p_store_id: ID.aeon, p_branch_id: AEON_BSD });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('"Tidak tahu cabangnya": hanya toko (cabang tidak diketahui)', async () => {
    withSession(null);
    setUrl('/kamera', `jenis=label&toko=${ID.aeon}`);
    await renderWithProviders(<LabelCamera />);
    await waitFor(() =>
      expect(screen.getByTestId('label-target').textContent).toBe('Label masuk ke AEON · cabang tidak diketahui.'),
    );
  });
});
