// @vitest-environment jsdom
// L5b M2: S-06 sheet foto, S-07 kamera struk/screenshot, S-07b galeri, dialog duplikat U-10
// (docs/07 §7.3). Antrean memakai OutboxProvider asli di atas IndexedDB tiruan; Storage/RPC/REST
// lewat klien Supabase tiruan harness M1.
import '../m1/mocks';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID, installDomPolyfills, nav, renderWithProviders, resetHarness, sb, setUrl, state } from '../m1/harness';

const { PhotoSheet } = await import('@/components/app/photo-sheet');
const { CaptureScreen } = await import('@/features/capture/capture-screen');
const { OutboxStore, newItem } = await import('@/lib/offline/outbox-store');
const { takePendingFiles, setPendingFiles } = await import('@/lib/media/handoff');

installDomPolyfills();

const FIXTURE = new Uint8Array(
  readFileSync(resolve(import.meta.dirname, '../../../worker/test/fixtures/struk-aeon.jpg')),
);
const file = (name: string, body: string | Uint8Array<ArrayBuffer> = FIXTURE, type = 'image/jpeg') =>
  new File([body], name, { type, lastModified: Date.parse('2026-10-19T03:00:00Z') });

const store = () => OutboxStore.forUser(ID.user);
const submitted = () =>
  sb.rpc.mock.calls.filter(([fn]) => fn === 'submit_capture').map(([, a]) => a as Record<string, unknown>);

beforeEach(async () => {
  await resetHarness();
  nav.back.mockReset();
  Object.defineProperty(window.history, 'length', { configurable: true, value: 2 });
});

describe('S-06 Foto apa? (?sheet=foto)', () => {
  it('urutan U-08 tanpa sesi: Struk, Label harga, Screenshot, lalu galeri', async () => {
    setUrl('/unggahan', 'sheet=foto');
    await renderWithProviders(<PhotoSheet />);
    const dialog = await screen.findByRole('dialog', { name: 'Foto apa?' });
    const labels = within(dialog)
      .getAllByText(/^(Struk|Label harga|Screenshot marketplace|Pilih dari galeri)$/)
      .map((e) => e.textContent);
    expect(labels).toEqual(['Struk', 'Label harga', 'Screenshot marketplace', 'Pilih dari galeri']);
  });

  it('Label tanpa sesi: pesan (kamera label = M4, F-53), tidak membuka halaman yang belum ada (D-85)', async () => {
    setUrl('/', 'sheet=foto');
    await renderWithProviders(<PhotoSheet />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Label harga/ }));
    expect(screen.getByRole('status').textContent).toMatch(/Label harga butuh kamera label/);
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('Struk membuka kamera bawaan (<input capture>) dan menyerahkan foto ke /kamera?jenis=struk', async () => {
    setUrl('/', 'sheet=foto');
    await renderWithProviders(<PhotoSheet />);
    const input = (await screen.findByTestId('sheet-input-receipt')) as HTMLInputElement;
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.accept).toBe('image/*');
    await userEvent.setup().upload(input, file('a.jpg'));
    expect(nav.replace).toHaveBeenCalledWith('/kamera?jenis=struk');
    expect(takePendingFiles('receipt')).toMatchObject({ source: 'camera', files: [expect.any(File)] });
  });

  it('galeri (banyak file) → /kamera?jenis=struk&sumber=galeri; screenshot → /kamera?jenis=screenshot', async () => {
    setUrl('/', 'sheet=foto');
    await renderWithProviders(<PhotoSheet />);
    const u = userEvent.setup();
    await u.upload(await screen.findByTestId('sheet-input-gallery'), [file('a.jpg'), file('b.jpg')]);
    expect(nav.replace).toHaveBeenLastCalledWith('/kamera?jenis=struk&sumber=galeri');
    expect(takePendingFiles('receipt')?.files).toHaveLength(2);
    await u.upload(screen.getByTestId('sheet-input-screenshot'), file('s.png', 'x', 'image/png'));
    expect(nav.replace).toHaveBeenLastCalledWith('/kamera?jenis=screenshot');
  });
});

describe('S-07 Kamera struk', () => {
  const render = () => renderWithProviders(<CaptureScreen kind="receipt" />);

  it('kosong: panduan kualitas + shutter di bawah; Selesai nonaktif', async () => {
    await render();
    expect(screen.getByText(/Pastikan seluruh struk terlihat dan tidak terlipat/)).toBeTruthy();
    expect(screen.getByText('Belum ada foto.')).toBeTruthy();
    expect(screen.getByLabelText('Ambil foto')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Selesai' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('struk panjang: Tambah bagian, ubah urutan, hapus; Selesai → antrean (urutan bagian) → W1 → kembali + toast', async () => {
    await render();
    const u = userEvent.setup();
    await u.upload(screen.getByLabelText('Ambil foto'), file('1.jpg', 'bagian-satu'));
    await u.upload(await screen.findByLabelText('Tambah bagian'), file('2.jpg', 'bagian-dua'));
    await u.upload(screen.getByLabelText('Tambah bagian'), file('3.jpg', 'bagian-tiga'));
    await waitFor(() => expect(screen.getAllByTestId('part')).toHaveLength(3));
    await u.click(screen.getByRole('button', { name: 'Pindahkan bagian 3 ke depan' }));
    await u.click(screen.getByRole('button', { name: 'Hapus bagian 1' }));
    expect(screen.getAllByTestId('part')).toHaveLength(2);
    await u.click(screen.getByRole('button', { name: 'Selesai' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'));
    expect(toast.success).toHaveBeenCalledWith('Struk diunggah. Kami kabari kalau perlu dicek.');
    await waitFor(() => expect(submitted()).toHaveLength(1));
    const sub = submitted()[0]!;
    const { createHash } = await import('node:crypto');
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    // Bagian 3 dipindah ke depan, bagian 1 dihapus: urutan = tiga, dua.
    expect(sub.p_images).toEqual([
      { position: 1, ext: 'jpg', sha256: sha('bagian-tiga'), byte_size: 11 },
      { position: 2, ext: 'jpg', sha256: sha('bagian-dua'), byte_size: 10 },
    ]);
    expect(sub).toMatchObject({ p_kind: 'receipt', p_shopping_session_id: null });
    expect(String(sub.p_captured_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    const paths = state.storage.upload.mock.calls.map(([p]) => p);
    expect(paths).toEqual([
      expect.stringMatching(new RegExp(`^[0-9a-f-]{36}/${sub.p_capture_id}/1\\.jpg$`)),
      expect.stringMatching(new RegExp(`/${sub.p_capture_id}/2\\.jpg$`)),
    ]);
    expect(state.storage.upload.mock.calls[0]![2]).toMatchObject({ upsert: false, contentType: 'image/jpeg' });
  });

  it('batas 10 bagian (D-81)', async () => {
    await render();
    const u = userEvent.setup();
    await u.upload(screen.getByLabelText('Ambil foto'), file('0.jpg', 'b0'));
    for (let i = 1; i < 10; i++)
      await u.upload(await screen.findByLabelText('Tambah bagian'), file(`${i}.jpg`, `b${i}`));
    await waitFor(() => expect(screen.getAllByTestId('part')).toHaveLength(10));
    expect(screen.getByText('Maksimal 10 bagian per struk.')).toBeTruthy();
    expect((screen.getByTestId('input-camera') as HTMLInputElement).disabled).toBe(true);
  });

  it('format tidak didukung → pesan §8.2, foto tidak ditambahkan', async () => {
    await render();
    await userEvent
      .setup({ applyAccept: false })
      .upload(screen.getByLabelText('Ambil foto'), file('a.gif', 'GIF89a', 'image/gif'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Foto terlalu besar atau formatnya tidak didukung/);
    await waitFor(() => expect(screen.queryAllByTestId('part')).toHaveLength(0));
  });

  it('offline: disimpan di HP, toast "Foto disimpan di HP…", belum ada request', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await render();
    const u = userEvent.setup();
    await u.upload(screen.getByLabelText('Ambil foto'), file('a.jpg'));
    await waitFor(() => expect(screen.getAllByTestId('part')).toHaveLength(1));
    await u.click(screen.getByRole('button', { name: 'Selesai' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Foto disimpan di HP. Akan diunggah saat ada sinyal.'),
    );
    const { items } = await store().list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'receipt', duplicate: { status: 'pending' } });
    expect(items[0]!.state === 'captured' || items[0]!.state === 'waiting_network').toBe(true);
    expect(submitted()).toEqual([]);
    expect(sb.from).not.toHaveBeenCalledWith('capture_image');
  });

  it('duplikat hash (U-10): dialog sebelum unggah; Tetap unggah → diunggah', async () => {
    state.rest.capture_image = () => ({
      data: [{ capture_id: '22222222-2222-4222-8222-222222222222', created_at: '2026-10-12T05:00:00Z' }],
      error: null,
    });
    await render();
    const u = userEvent.setup();
    await u.upload(screen.getByLabelText('Ambil foto'), file('a.jpg'));
    await waitFor(() => expect(screen.getAllByTestId('part')).toHaveLength(1));
    await u.click(screen.getByRole('button', { name: 'Selesai' }));
    const dialog = await screen.findByRole('dialog', { name: 'Foto ini sudah pernah diunggah' });
    expect(dialog.textContent).toContain('12 Okt 2026');
    expect(state.storage.upload).not.toHaveBeenCalled();
    await u.click(within(dialog).getByRole('button', { name: 'Tetap unggah' }));
    await waitFor(() => expect(submitted()).toHaveLength(1));
    expect(nav.replace).toHaveBeenCalledWith('/');
  });

  it('duplikat: Lihat yang lama → S-09 capture lama; foto baru tetap ditahan di antrean', async () => {
    state.rest.capture_image = () => ({
      data: [{ capture_id: '22222222-2222-4222-8222-222222222222', created_at: '2026-10-12T05:00:00Z' }],
      error: null,
    });
    await render();
    const u = userEvent.setup();
    await u.upload(screen.getByLabelText('Ambil foto'), file('a.jpg'));
    await waitFor(() => expect(screen.getAllByTestId('part')).toHaveLength(1));
    await u.click(screen.getByRole('button', { name: 'Selesai' }));
    await u.click(await screen.findByRole('button', { name: 'Lihat yang lama' }));
    expect(nav.replace).toHaveBeenCalledWith('/unggahan/detail?id=22222222-2222-4222-8222-222222222222');
    expect((await store().list()).items[0]!.duplicate.status).toBe('found');
  });

  it('antrean > 50 MB → peringatan (D-81)', async () => {
    const big = newItem({
      capture_id: '33333333-3333-4333-8333-333333333333',
      kind: 'receipt',
      household_id: null,
      shopping_session_id: null,
      store_id: null,
      branch_id: null,
      captured_at: null,
      parts: [
        { position: 1, ext: 'jpg', content_type: 'image/jpeg', sha256: 'a'.repeat(64), byte_size: 60 * 1024 * 1024 },
      ],
    });
    await store().add({ ...big, duplicate: { status: 'found', matches: [] } }, new Map([[1, new Blob(['x'])]]));
    await render();
    const u = userEvent.setup();
    await u.upload(screen.getByLabelText('Ambil foto'), file('a.jpg'));
    await waitFor(() => expect(screen.getAllByTestId('part')).toHaveLength(1));
    await u.click(screen.getByRole('button', { name: 'Selesai' }));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/^Antrean foto di HP sudah 60 MB/)),
    );
  });

  it('foto dari sheet S-06 langsung masuk sebagai bagian 1', async () => {
    setPendingFiles({ kind: 'receipt', source: 'camera', files: [file('a.jpg')] });
    await render();
    await waitFor(() => expect(screen.getAllByTestId('part')).toHaveLength(1));
  });
});

describe('S-07b galeri (U-09)', () => {
  const three = () => [file('a.jpg', 'g-a'), file('b.jpg', 'g-b'), file('c.jpg', 'g-c')];

  it('3 struk berbeda → 3 capture', async () => {
    await renderWithProviders(<CaptureScreen kind="receipt" />);
    const u = userEvent.setup();
    await u.upload(screen.getByTestId('input-gallery'), three());
    const dialog = await screen.findByRole('dialog', { name: '3 gambar dipilih' });
    expect(dialog.textContent).toContain('Ini 3 struk berbeda atau 1 struk panjang?');
    await u.click(within(dialog).getByRole('button', { name: '3 struk berbeda' }));
    await waitFor(() => expect(submitted()).toHaveLength(3));
    expect(submitted().every((s) => (s.p_images as unknown[]).length === 1)).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('3 struk diunggah. Kami kabari kalau perlu dicek.');
  });

  it('1 struk panjang → 3 bagian di ThumbStrip, bisa diatur sebelum Selesai', async () => {
    await renderWithProviders(<CaptureScreen kind="receipt" />);
    const u = userEvent.setup();
    await u.upload(screen.getByTestId('input-gallery'), three());
    await u.click(await screen.findByRole('button', { name: '1 struk panjang' }));
    await waitFor(() => expect(screen.getAllByTestId('part')).toHaveLength(3));
    expect(submitted()).toEqual([]);
  });

  it('Atur sendiri: nomor per gambar → kelompok jadi capture', async () => {
    await renderWithProviders(<CaptureScreen kind="receipt" />);
    const u = userEvent.setup();
    await u.upload(screen.getByTestId('input-gallery'), three());
    await u.click(await screen.findByRole('button', { name: 'Atur sendiri' }));
    await u.selectOptions(screen.getByLabelText('Kelompok untuk gambar 2'), '1');
    await u.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(submitted()).toHaveLength(2));
    expect(
      submitted()
        .map((s) => (s.p_images as unknown[]).length)
        .sort(),
    ).toEqual([1, 2]);
  });

  it('screenshot: "beberapa screenshot berbeda" pilihan pertama', async () => {
    await renderWithProviders(<CaptureScreen kind="marketplace" />);
    const u = userEvent.setup();
    expect(screen.getByText(/Pilih screenshot halaman produk/)).toBeTruthy();
    await u.upload(screen.getByTestId('input-screenshot'), [file('a.png', 'p-a'), file('b.png', 'p-b')]);
    const dialog = await screen.findByRole('dialog', { name: '2 gambar dipilih' });
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons[0]!.textContent).toBe('2 screenshot berbeda');
    await u.click(buttons[0]!);
    await waitFor(() => expect(submitted()).toHaveLength(2));
    expect(submitted()[0]).toMatchObject({ p_kind: 'marketplace' });
  });
});

it('tanpa interaksi tidak ada panggilan Storage (vi.fn bersih)', () => {
  expect(vi.isMockFunction(state.storage.upload)).toBe(true);
});
