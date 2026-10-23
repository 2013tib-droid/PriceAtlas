// @vitest-environment jsdom
// L5b M3: S-11 Konfirmasi label & screenshot di setiap keadaan §7.3, memakai keluaran R16/W5/W18 ASLI
// (label-milo: 2 label "1/2", tanpa toko; shopee-milo: ongkir sebagai info, D-36; confirm_capture_items
// STORE_REQUIRED / NO_APPLICABLE_PRICE; update_capture_item STALE_WRITE).
import '../m1/mocks';
import type { CaptureItem } from '@priceatlas/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fx,
  installDomPolyfills,
  m3Ids,
  nav,
  renderWithProviders,
  resetHarness,
  sb,
  setUrl,
  state,
} from '../m1/harness';

const { ItemsScreen } = await import('@/features/observation/items-screen');
const { completeLocationPick, openLocationHref } = await import('@/lib/confirm/location-handoff');
const { PATCH_DEBOUNCE_MS } = await import('@/lib/confirm/item-patch');

installDomPolyfills();

const err = (key: string) => ({ data: null, error: fx<{ error: unknown }>(key).error });
const items = (k: string) => fx<CaptureItem[]>(`items_${k}`);

beforeEach(async () => {
  await resetHarness();
});
afterEach(() => vi.useRealTimers());

async function open(key: 'label' | 'shopee' | 'shopee_pending', data?: CaptureItem[]) {
  const id = m3Ids().items[key];
  setUrl('/konfirmasi', `capture=${id}`);
  if (data) state.rpcOverride = (fn) => (fn === 'get_capture_items' ? { data, error: null } : undefined);
  const view = await renderWithProviders(<ItemsScreen />);
  await screen.findByTestId('items-screen');
  await screen.findAllByTestId('observation-item');
  return { ...view, id };
}
const cards = () => screen.getAllByTestId('observation-item');
const saveBtn = () => screen.getByTestId('save-items') as HTMLButtonElement;

describe('S-11 label (label-milo)', () => {
  it('memuat: skeleton', async () => {
    setUrl('/konfirmasi', `capture=${m3Ids().items.label}`);
    state.rpcOverride = (fn) => (fn === 'get_capture_items' ? new Promise(() => undefined) : undefined);
    await renderWithProviders(<ItemsScreen />);
    expect(screen.getByRole('status').textContent).toBe('Memuat…');
  });

  it('NOT_FOUND (R16 asli)', async () => {
    setUrl('/konfirmasi', 'capture=99999999-0000-0000-0000-000000000000');
    await renderWithProviders(<ItemsScreen />);
    expect(await screen.findByText('Data ini tidak ditemukan. Mungkin sudah dihapus.')).toBeTruthy();
  });

  it('2 label "1/2", crop region dengan signed URL 300 dtk, saran + computed live, toko belum diketahui, catatan member', async () => {
    await open('label');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cek label harga');
    const [a, b] = cards();
    expect(a!.textContent).toMatch(/^1\/2/);
    expect(b!.textContent).toMatch(/^2\/2/);
    const path = fx<{ images: { storage_path: string }[] }>('capture_label').images[0]!.storage_path;
    await waitFor(() => expect(state.storage.createSignedUrl).toHaveBeenCalledWith(path, 300));
    const crop = (await within(a!).findByTestId('item-crop')).querySelector('img')!;
    expect(crop.style.width).toBe('250%'); // region w 0,4
    expect(crop.style.left).toBe('-12.5%'); // x 0,05 / w 0,4
    expect(a!.textContent).toMatch(/"MILO ORIGINAL 200G"/);
    expect(a!.textContent).toMatch(/→ Milo Original 200 g\?/);
    expect(within(a!).getByTestId('computed').textContent).toMatch(/→ Dihitung untukmu:Rp17.500PROMORp87,5\/g/);
    expect(within(a!).getByTestId('store-missing').textContent).toBe('Toko belum diketahui');
    expect(b!.textContent).toMatch(/→ Milo 3in1 10 × 35 g\?ragu/);
    expect(within(b!).getByTestId('computed').textContent).toMatch(
      /Catatan member: AEON Member 21000 \(program belum ada di katalog, tidak dihitung\)/,
    );
    expect(saveBtn().textContent).toBe('Simpan 2 harga');
  });

  it('ubah harga normal → W18 sekali setelah jeda (debounce) dengan p_expected_updated_at', async () => {
    await open('label');
    const user = userEvent.setup();
    const input = within(cards()[0]!).getByLabelText('Harga normal') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '19000');
    expect(within(cards()[0]!).getByTestId('computed').textContent).toMatch(/Menghitung…/);
    await waitFor(
      () =>
        expect(sb.rpc).toHaveBeenCalledWith('update_capture_item', {
          p_item_id: items('label')[0]!.id,
          p_patch: { normal_price: 19000 },
          p_expected_updated_at: items('label')[0]!.updated_at,
        }),
      { timeout: PATCH_DEBOUNCE_MS + 2000 },
    );
    expect(sb.rpc.mock.calls.filter(([fn]) => fn === 'update_capture_item')).toHaveLength(1);
    expect(input.value).toBe('19000');
  });

  it('STALE_WRITE (W18 asli) → muat ulang R16 + toast, perubahan user dikirim ulang dengan versi terbaru', async () => {
    await open('label');
    const latest = items('label').map((i, n) => (n === 0 ? { ...i, updated_at: '2026-10-21T01:00:00+07:00' } : i));
    let first = true;
    state.rpcOverride = (fn) => {
      if (fn === 'update_capture_item' && first) {
        first = false;
        return err('update_item_stale');
      }
      if (fn === 'get_capture_items') return { data: latest, error: null };
      return undefined;
    };
    const user = userEvent.setup();
    const input = within(cards()[0]!).getByLabelText('Harga normal');
    await user.clear(input);
    await user.type(input, '18000');
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/baru saja berubah di tempat lain/)), {
      timeout: 4000,
    });
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('update_capture_item', {
        p_item_id: items('label')[0]!.id,
        p_patch: { normal_price: 18000 },
        p_expected_updated_at: '2026-10-21T01:00:00+07:00',
      }),
    );
  });

  it('Simpan → STORE_REQUIRED (W5 asli) → pesan + "Ubah" → S-12 mode koreksi', async () => {
    const { id } = await open('label');
    state.rpcOverride = (fn) => (fn === 'confirm_capture_items' ? err('confirm_items_store_required') : undefined);
    const user = userEvent.setup();
    await user.click(saveBtn());
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('confirm_capture_items', {
        p_capture_id: id,
        p_items: items('label').map((i) => ({ item_id: i.id, action: 'accept' })),
      }),
    );
    const alert = await screen.findByTestId('save-error');
    expect(alert.textContent).toMatch(/Pilih toko untuk harga ini\. Cabangnya boleh tidak diisi\./);
    await user.click(within(alert).getByRole('button', { name: 'Ubah' }));
    expect(nav.push).toHaveBeenCalledWith(
      `/lokasi?mode=koreksi&untuk=items%3A${id}&kembali=%2Fkonfirmasi%3Fcapture%3D${id}`,
    );
  });

  it('hasil S-12 → W18 store_id/branch_id untuk semua item yang belum disimpan', async () => {
    const id = m3Ids().items.label;
    openLocationHref('koreksi', `items:${id}`, `/konfirmasi?capture=${id}`);
    completeLocationPick(`items:${id}`, {
      store: { id: '20000000-0000-0000-0000-000000000001', name: 'AEON', channel: 'offline', is_private: false },
      branch: { id: '30000000-0000-0000-0000-000000000001', name: 'AEON BSD', status: 'open' },
    });
    await open('label');
    for (const i of items('label'))
      await waitFor(() =>
        expect(sb.rpc).toHaveBeenCalledWith('update_capture_item', {
          p_item_id: i.id,
          p_patch: {
            store_id: '20000000-0000-0000-0000-000000000001',
            branch_id: '30000000-0000-0000-0000-000000000001',
          },
          p_expected_updated_at: i.updated_at,
        }),
      );
  });

  it('NO_APPLICABLE_PRICE (W5 asli) → pesan + fokus harga normal item itu', async () => {
    await open('label', [items('label')[0]!, fx<CaptureItem>('update_item_member_price')]);
    expect(within(cards()[1]!).getByTestId('computed').textContent).toMatch(
      /Belum ada harga yang berlaku untukmu di tanggal ini/,
    );
    state.rpcOverride = (fn) =>
      fn === 'confirm_capture_items'
        ? err('confirm_items_no_price')
        : fn === 'get_capture_items'
          ? { data: [items('label')[0]!, fx<CaptureItem>('update_item_member_price')], error: null }
          : undefined;
    await userEvent.setup().click(saveBtn());
    expect((await screen.findByTestId('save-error')).textContent).toMatch(
      /Belum ada harga yang berlaku untukmu di tanggal ini\. Isi harga normal/,
    );
    await waitFor(() => expect(document.activeElement).toBe(within(cards()[1]!).getByLabelText('Harga normal')));
  });

  it('harga member belum berlaku (D-27): "Saya member" → W16 → R16 dimuat ulang + kalimat D-41', async () => {
    const member = fx<CaptureItem>('update_item_member_price');
    await open('label', [member]);
    const card = cards()[0]!;
    expect(within(card).getByTestId('computed').textContent).toMatch(
      /Harga member tidak dihitung: kamu belum terdaftar AEON Member\./,
    );
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Saya member' }));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('set_program_membership', {
        p_program_id: member.member_program_id,
        p_member: true,
      }),
    );
    await waitFor(() =>
      expect(sb.rpc.mock.calls.filter(([fn]) => fn === 'get_capture_items').length).toBeGreaterThanOrEqual(2),
    );
    expect(await screen.findByText(/Hanya item di layar ini yang dihitung ulang/)).toBeTruthy();
  });

  it('promo sudah berakhir (tanggal di luar periode) → "Dihitung harga normal"', async () => {
    const i = items('label')[0]!;
    await open('label', [
      {
        ...i,
        promo_valid_until: '2026-01-31',
        computed: { ...i.computed!, price_basis: 'normal', effective_price: 19500, unit_price: 97.5 },
      },
    ]);
    expect(within(cards()[0]!).getByTestId('computed').textContent).toMatch(
      /Promo sudah berakhir\. Dihitung harga normal\./,
    );
  });

  it('promo kuantitas, bundle → W18 is_bundle, "Bukan label harga" → W5 reject', async () => {
    const { id } = await open('label');
    const user = userEvent.setup();
    const [a, b] = cards();
    await user.click(within(a!).getByLabelText('Ini bundle (paket campuran)'));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith(
        'update_capture_item',
        expect.objectContaining({ p_patch: { is_bundle: true } }),
      ),
    );
    await user.click(within(b!).getByRole('button', { name: 'Bukan label harga' }));
    expect(saveBtn().textContent).toBe('Simpan 1 harga');
    await user.click(saveBtn());
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('confirm_capture_items', {
        p_capture_id: id,
        p_items: [
          { item_id: items('label')[0]!.id, action: 'accept' },
          { item_id: items('label')[1]!.id, action: 'reject' },
        ],
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 harga baru tersimpan'));
    expect(await screen.findByTestId('summary-updating')).toBeTruthy();
  });

  it('produk belum dikenali → "Pilih produk" / "Buat produk baru" (S-14 / S-15 lapisan)', async () => {
    const i = items('label')[0]!;
    const { id } = await open('label', [{ ...i, suggestion: null, suggested_product_id: null }]);
    expect(within(cards()[0]!).getByTestId('no-product').textContent).toBe('Produk belum dikenali');
    expect(saveBtn().disabled).toBe(true);
    await userEvent.setup().click(within(cards()[0]!).getByRole('button', { name: 'Buat produk baru' }));
    expect(nav.push).toHaveBeenCalledWith(`/konfirmasi?capture=${id}&pilih=produk&untuk=item%3A${i.id}&baru=1`, {
      scroll: false,
    });
  });
});

describe('S-11 screenshot (shopee-milo)', () => {
  it('judul listing, seller, ongkir sebagai info (D-36), "harga belum termasuk ongkir", simpan → W5', async () => {
    const { id } = await open('shopee_pending');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cek screenshot');
    const card = cards()[0]!;
    expect(card.textContent).toMatch(/Judul listing: "Milo Original 500 g Nestle"/);
    expect(card.textContent).toMatch(/Seller: Nestle Official Store/);
    expect(within(card).getByTestId('marketplace-extra').textContent).toBe(
      'Ongkir Rp9.000 (info, tidak mengubah harga)',
    );
    expect(card.textContent).toMatch(/harga belum termasuk ongkir/);
    expect(within(card).getByTestId('computed').textContent).toMatch(/Rp47.000NORMALRp94\/g/);
    expect(within(card).queryByTestId('size-mismatch')).toBeNull();
    await userEvent.setup().click(saveBtn());
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('confirm_capture_items', {
        p_capture_id: id,
        p_items: [{ item_id: items('shopee_pending')[0]!.id, action: 'accept' }],
      }),
    );
  });

  it('judul listing beda ukuran dengan produk dipilih → peringatan klien, simpan tetap bisa', async () => {
    const i = items('shopee_pending')[0]!;
    const milo200 = i.candidates.find((c) => c.content_size === 200)!;
    await open('shopee_pending', [{ ...i, suggestion: milo200, suggested_product_id: milo200.id }]);
    expect(within(cards()[0]!).getByTestId('size-mismatch').textContent).toBe(
      'Judul menyebut 500 g, produk yang dipilih 200 g.',
    );
    expect(saveBtn().disabled).toBe(false);
  });

  it('sudah disimpan otomatis (accepted): "Tersimpan", tanpa editor dan tombol simpan', async () => {
    await open('shopee');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Harga dari foto');
    expect(within(cards()[0]!).getByTestId('item-accepted').textContent).toBe('Tersimpan');
    expect(screen.queryByTestId('save-items')).toBeNull();
    expect(screen.queryByLabelText('Harga normal')).toBeNull();
  });
});

describe('S-11 lapisan S-14', () => {
  it('Ganti → pilih kandidat → W18 product_id', async () => {
    const i = items('label')[0]!;
    setUrl('/konfirmasi', `capture=${m3Ids().items.label}&pilih=produk&untuk=item:${i.id}`);
    await renderWithProviders(<ItemsScreen />);
    const picker = await screen.findByTestId('product-picker');
    expect((screen.getByLabelText('Cari produk') as HTMLInputElement).value).toBe('MILO ORIGINAL 200G');
    const candidates = within(picker).getAllByTestId('pick-candidate');
    expect(candidates).toHaveLength(2); // 500 g + 1 kg (saran 200 g tidak diulang)
    expect(candidates[0]!.textContent).toMatch(/Teks menyebut 200G, produk ini 500 g\./);
    await act(async () => {
      await userEvent.setup().click(within(candidates[0]!).getByRole('button'));
    });
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('update_capture_item', {
        p_item_id: i.id,
        p_patch: { product_id: i.candidates[1]!.id },
        p_expected_updated_at: i.updated_at,
      }),
    );
  });
});
