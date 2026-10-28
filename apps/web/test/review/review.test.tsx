// @vitest-environment jsdom
// L5 6b M4 (docs/08 §11.2, §13.2): S-13 thumbnail label dari R18 `thumbnail_path` (satu panggilan
// createSignedUrls, Q-97), teks alias S-16/S-18 dari R20 `source_text` (Q-87). Keluaran R18/R20 ASLI
// (test/fixtures/rpc.json). Status per item S-13 (Q-81) diuji di test/m4/session.test.tsx.
import '../m1/mocks';
import type { ActiveSession, PriceRecordDetail } from '@priceatlas/contracts';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fx, installDomPolyfills, renderWithProviders, resetHarness, setUrl, state } from '../m1/harness';

const { ShoppingScreen } = await import('@/features/shopping/shopping-screen');
const { aliasText } = await import('@/lib/catalog/record-form');

installDomPolyfills();

const MIN = 60_000;
const session = (patch?: (s: ActiveSession) => void) => {
  const s = structuredClone(fx<ActiveSession>('session_labels'));
  patch?.(s);
  state.rpcOverride = (fn) => (fn === 'get_active_session' ? { data: s, error: null } : undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.parse(s.session.started_at) + 30 * MIN));
  return s;
};
const open = async () => {
  setUrl('/belanja');
  await renderWithProviders(<ShoppingScreen />);
  await screen.findByText(/Label di sesi ini/);
};

beforeEach(async () => {
  await resetHarness();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('S-13 thumbnail (Q-97, D-79)', () => {
  it('semua thumbnail label lewat SATU createSignedUrls; baris memakai foto, bukan ikon', async () => {
    const s = session();
    await open();
    const paths = [...new Set(s.labels.flatMap((l) => (l.thumbnail_path ? [l.thumbnail_path] : [])))].sort();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-testid="session-label"] img').length).toBeGreaterThan(0),
    );
    expect(state.storage.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(state.storage.createSignedUrls).toHaveBeenCalledWith(paths, 300);
    expect(state.storage.createSignedUrl).not.toHaveBeenCalled();
    const imgs = [...document.querySelectorAll<HTMLImageElement>('[data-testid="session-label"] img')];
    // Foto dekoratif: nama produk ada di baris yang sama.
    expect(imgs.every((i) => i.alt === '')).toBe(true);
    const done = s.labels.find((l) => l.status === 'done')!;
    expect(
      imgs.some((i) => i.src.includes(encodeURI(done.thumbnail_path!)) || i.src.includes(done.thumbnail_path!)),
    ).toBe(true);
  });

  it('gambar sudah di-purge (thumbnail_path null) → ikon, tanpa permintaan signed URL', async () => {
    session((s) => s.labels.forEach((l) => (l.thumbnail_path = null)));
    await open();
    expect(screen.getAllByTestId('session-label').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-testid="session-label"] img')).toHaveLength(0);
    expect(state.storage.createSignedUrls).not.toHaveBeenCalled();
  });

  it('signed URL gagal → ikon (kartu tetap tampil)', async () => {
    state.storage.createSignedUrls.mockImplementationOnce(async () => ({ data: null, error: new Error('boom') }));
    session();
    await open();
    await vi.waitFor(() => expect(state.storage.createSignedUrls).toHaveBeenCalled());
    expect(document.querySelectorAll('[data-testid="session-label"] img')).toHaveLength(0);
    expect(screen.getAllByTestId('session-label').length).toBe(6);
  });
});

describe('teks alias S-16/S-18 dari R20 source_text (Q-87, F-72)', () => {
  it('label, screenshot, struk (keluaran R20 asli)', () => {
    expect(aliasText(fx<PriceRecordDetail>('record_label'))).toBe('MILO ORIGINAL 200G');
    expect(aliasText(fx<PriceRecordDetail>('record_shopee'))).toBe('Milo Original 500 g');
    expect(aliasText(fx<PriceRecordDetail>('record_receipt'))).toBe('MILO ORI 500G');
  });
  it('tanpa sumber teks → null; keluaran R20 lama tanpa source_text → teks baris struk', () => {
    expect(aliasText({ source_text: null, receipt_line: null })).toBeNull();
    expect(aliasText({ source_text: '  ', receipt_line: null })).toBeNull();
    expect(aliasText({ receipt_line: { raw_text: 'INDOMIE GRG' } })).toBe('INDOMIE GRG');
  });
});
