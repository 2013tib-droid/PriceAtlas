// @vitest-environment jsdom
// L5b D-100: mode pemakaian pribadi tanpa anggaran AI — saklar foto (NEXT_PUBLIC_PHOTO_CAPTURE), S-21
// Tempel struk dari Gemini (tolak format salah di klien, Q-149; pratinjau; W1b), S-06 dan /kamera saat
// foto mati. Harness M1 (klien Supabase + router tiruan).
import '../m1/mocks';
import { GEMINI_RECEIPT_PROMPT, parsePastedReceipt } from '@priceatlas/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomPolyfills, nav, renderWithProviders, resetHarness, sb, setUrl, state } from '../m1/harness';

const { PasteScreen, pasteErrorText } = await import('@/features/paste/paste-screen');
const { PhotoSheet } = await import('@/components/app/photo-sheet');
const { CameraScreen } = await import('@/features/scan/camera-screen');
const { photoCaptureEnabled } = await import('@/lib/features');

installDomPolyfills();

const VALID = JSON.stringify({
  format: 'priceatlas-struk-v1',
  store: { name: 'AEON', branch: 'BSD' },
  date: '2026-10-19',
  total: 88000,
  lines: [
    { type: 'product', text: 'MILO ORI 500G', quantity: 2, unit_price: 45000, amount: 90000 },
    { type: 'discount', text: 'DISC', amount: -2000, applies_to: 1 },
  ],
});

const submitted = () =>
  sb.rpc.mock.calls.filter(([fn]) => fn === 'submit_text_capture').map(([, a]) => a as Record<string, unknown>);

const paste = (text: string) => fireEvent.change(screen.getByLabelText('Jawaban Gemini'), { target: { value: text } });

beforeEach(async () => {
  await resetHarness();
  nav.push.mockReset();
  nav.replace.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('saklar foto (D-100)', () => {
  it('default mati; hanya "on" yang menyalakan', () => {
    vi.stubEnv('NEXT_PUBLIC_PHOTO_CAPTURE', undefined);
    expect(photoCaptureEnabled()).toBe(false);
    expect(photoCaptureEnabled('')).toBe(false);
    expect(photoCaptureEnabled('off')).toBe(false);
    expect(photoCaptureEnabled(' ON ')).toBe(true);
  });

  it('foto mati: S-06 hanya menawarkan Tempel struk → S-21', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHOTO_CAPTURE', 'off');
    setUrl('/', 'sheet=foto');
    await renderWithProviders(<PhotoSheet />);
    const dialog = await screen.findByRole('dialog', { name: 'Tambah struk' });
    expect(within(dialog).queryByText('Struk')).toBeNull();
    expect(within(dialog).queryByText('Pilih dari galeri')).toBeNull();
    expect(dialog.querySelector('input[type=file]')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: /Tempel struk dari Gemini/ }));
    expect(nav.replace).toHaveBeenCalledWith('/tempel');
  });

  it('foto mati: /kamera?jenis=struk → pesan + tautan ke S-21; barcode tetap jalan', async () => {
    vi.stubEnv('NEXT_PUBLIC_PHOTO_CAPTURE', 'off');
    setUrl('/kamera', 'jenis=struk');
    await renderWithProviders(<CameraScreen />);
    expect(await screen.findByRole('heading', { name: 'Foto sedang dimatikan' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Tempel struk/ }).getAttribute('href')).toBe('/tempel');
  });
});

describe('S-21 Tempel struk dari Gemini', () => {
  it('prompt bisa disalin dan dibaca', async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
    await renderWithProviders(<PasteScreen />);
    await userEvent.click(screen.getByRole('button', { name: /Salin prompt/ }));
    expect(write).toHaveBeenCalledWith(GEMINI_RECEIPT_PROMPT);
    expect(screen.getByTestId('gemini-prompt').textContent).toBe(GEMINI_RECEIPT_PROMPT);
  });

  it('bukan JSON → pesan, kirim nonaktif, tidak ada RPC (Q-149)', async () => {
    await renderWithProviders(<PasteScreen />);
    const send = screen.getByRole('button', { name: /Kirim struk/ });
    expect(send).toHaveProperty('disabled', true);
    paste('Maaf, foto kurang jelas.');
    expect((await screen.findByRole('alert')).textContent).toMatch(/bukan JSON/);
    expect(screen.getByLabelText('Jawaban Gemini').getAttribute('aria-invalid')).toBe('true');
    expect(send).toHaveProperty('disabled', true);
    paste('{"lines": []}');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Format JSON tidak sesuai \(lines:/);
    expect(submitted()).toEqual([]);
  });

  it('JSON valid → pratinjau, peringatan total, kirim W1b lalu S-09', async () => {
    state.rpcOverride = (fn, a) =>
      fn === 'submit_text_capture'
        ? { data: { capture_id: a.p_capture_id, status: 'uploaded', created: true }, error: null }
        : undefined;
    await renderWithProviders(<PasteScreen />);
    paste(`\`\`\`json\n${VALID}\n\`\`\``);
    const preview = await screen.findByTestId('paste-preview');
    expect(preview.textContent).toContain('AEON · BSD');
    expect(preview.textContent).toContain('1 barang, 1 baris lain');
    expect(preview.textContent).toMatch(/Rp\s?88\.000/);
    expect(within(preview).queryByRole('status')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Kirim struk/ }));
    await waitFor(() => expect(submitted()).toHaveLength(1));
    const a = submitted()[0]!;
    expect(a).toMatchObject({ p_kind: 'receipt', p_text: `\`\`\`json\n${VALID}\n\`\`\`` });
    expect(a.p_capture_id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/unggahan/detail?id=${a.p_capture_id}`));
  });

  it('total tidak cocok → peringatan, tetap bisa dikirim', async () => {
    await renderWithProviders(<PasteScreen />);
    paste(VALID.replace('88000', '99000'));
    const preview = await screen.findByTestId('paste-preview');
    expect(within(preview).getByRole('status').textContent).toMatch(/tidak sama dengan total/);
    expect(screen.getByRole('button', { name: /Kirim struk/ })).toHaveProperty('disabled', false);
  });

  it('pasteErrorText untuk setiap jenis error', () => {
    expect(pasteErrorText(parsePastedReceipt(VALID))).toBeNull();
    expect(pasteErrorText(parsePastedReceipt(''))).toMatch(/Tempel jawaban Gemini dulu/);
    expect(pasteErrorText(parsePastedReceipt('x'.repeat(50_001)))).toMatch(/terlalu panjang/);
  });
});
