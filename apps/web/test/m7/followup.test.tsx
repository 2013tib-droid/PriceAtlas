// @vitest-environment jsdom
// L5b tindak lanjut D-91: baris "Termurah sepanjang masa" diringkas jika record sama (Q-95),
// SearchDock/StickyAction mengikuti keyboard virtual lewat visualViewport (Q-96), onboarding tanpa
// tab bar (Q-100). Kartu dari keluaran R3 ASLI (test/fixtures/rpc.json `search_milo`).
import '../m1/mocks';
import type { ProductCard } from '@priceatlas/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freezeToday, fx, installDomPolyfills, renderWithProviders, resetHarness } from '../m1/harness';

const { ProductCard: Card } = await import('@/components/product/product-card');
const { SearchDock } = await import('@/components/app/search-dock');
const { StickyAction } = await import('@/components/app/sticky-action');
const { keyboardInset } = await import('@/lib/hooks/use-keyboard-inset');
const { default: OnboardingLayout } = await import('@/app/(onboarding)/layout');

installDomPolyfills();
beforeEach(async () => {
  await resetHarness();
  freezeToday();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as { visualViewport?: unknown }).visualViewport;
});

const card = (name: string, variant: string) =>
  fx<ProductCard[]>('search_milo').find((c) => c.product.name === name && c.product.variant === variant)!;

describe('Q-95: "Termurah sepanjang masa" diringkas jika record sama', () => {
  it('record sama dengan 90 hari → "sama dengan 90 hari terakhir", tanpa harga berulang', async () => {
    const c = card('Milo Original', '200 g');
    expect(c.summary!.best_all.record_id).toBe(c.summary!.best_90d!.record_id);
    await renderWithProviders(<Card card={c} />);
    const line = screen.getByTestId('best-all');
    expect(line.textContent).toBe('Termurah sepanjang masa:sama dengan 90 hari terakhir');
    expect(within(line).queryByText(/Rp/)).toBeNull();
  });

  it('record berbeda → harga, label, dan toko sepanjang masa tetap lengkap (D-02)', async () => {
    const c = card('Milo Original', '500 g');
    expect(c.summary!.best_all.record_id).not.toBe(c.summary!.best_90d!.record_id);
    await renderWithProviders(<Card card={c} />);
    const line = screen.getByTestId('best-all');
    expect(line.textContent).toContain('Termurah sepanjang masa:');
    expect(line.textContent).toMatch(/Rp[\d.]+/);
    expect(line.textContent).not.toContain('sama dengan 90 hari terakhir');
  });
});

describe('Q-96: bilah bawah mengikuti keyboard virtual (visualViewport)', () => {
  it('keyboardInset: tinggi yang tertutup; selisih kecil (bilah alamat) diabaikan', () => {
    expect(keyboardInset(800, { height: 460, offsetTop: 0 })).toBe(340);
    expect(keyboardInset(800, { height: 460, offsetTop: 40 })).toBe(300);
    expect(keyboardInset(800, { height: 760, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, null)).toBe(0);
  });

  function stubViewport(height: number) {
    const vv = Object.assign(new EventTarget(), { height, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    return vv;
  }

  it('SearchDock: kolom fokus + keyboard terbuka → menempel di atas keyboard; tanpa fokus → posisi biasa', async () => {
    const vv = stubViewport(800);
    await renderWithProviders(<SearchDock value="" onChange={() => undefined} onSubmit={() => undefined} />);
    const form = screen.getByRole('search');
    expect(form.style.bottom).toBe('');
    act(() => screen.getByRole('searchbox').focus());
    vv.height = 460;
    act(() => void vv.dispatchEvent(new Event('resize')));
    expect(form.style.bottom).toBe('340px');
    act(() => screen.getByRole('searchbox').blur());
    expect(form.style.bottom).toBe('');
  });

  it('StickyAction: hanya bergeser jika fokus di dalamnya (keyboard dari kolom lain tidak)', async () => {
    const vv = stubViewport(460);
    render(
      <>
        <input aria-label="lain" />
        <StickyAction>
          <input aria-label="di bilah" />
        </StickyAction>
      </>,
    );
    const bar = screen.getByLabelText('di bilah').parentElement!.parentElement!;
    act(() => screen.getByLabelText('lain').focus());
    act(() => void vv.dispatchEvent(new Event('resize')));
    expect(bar.style.bottom).toBe('');
    fireEvent.focusIn(screen.getByLabelText('di bilah'));
    act(() => screen.getByLabelText('di bilah').focus());
    expect(bar.style.bottom).toBe('340px');
  });
});

describe('Q-100: onboarding tanpa tab bar', () => {
  it('layout (onboarding): isi layar + strip offline, tanpa tab bar dan banner sesi', async () => {
    await renderWithProviders(
      <OnboardingLayout>
        <h1>Isi onboarding</h1>
      </OnboardingLayout>,
    );
    expect(await screen.findByRole('heading', { name: 'Isi onboarding' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Navigasi utama' })).toBeNull();
    expect(document.querySelector('[data-session-banner]')).toBeNull();
  });
});
