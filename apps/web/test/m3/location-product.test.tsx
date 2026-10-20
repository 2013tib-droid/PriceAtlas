// @vitest-environment jsdom
// L5b M3: S-12 Pilih toko & cabang (mode manual/koreksi), S-14 Pilih produk, S-15 Produk baru, di
// setiap keadaan §7.3. Data: R17/W17/W8 + REST store/branch/category ASLI (test/fixtures/rpc.json).
import '../m1/mocks';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fx, installDomPolyfills, nav, renderWithProviders, resetHarness, sb, setUrl, state } from '../m1/harness';

const { LocationScreen } = await import('@/features/location/location-screen');
const { NewProductScreen } = await import('@/features/new-product/new-product-screen');
const { NewProductForm } = await import('@/features/new-product/new-product-form');
const { ProductPicker } = await import('@/features/picker/product-picker');
const { openLocationHref, takeLocationPick } = await import('@/lib/confirm/location-handoff');

installDomPolyfills();

const err = (key: string) => ({ data: null, error: fx<{ error: unknown }>(key).error });
const AEON = '20000000-0000-0000-0000-000000000001';

beforeEach(async () => {
  await resetHarness();
});

describe('S-12 Pilih toko & cabang', () => {
  const target = 'receipt:r1';
  const open = async (mode = 'koreksi') => {
    setUrl('/lokasi', `mode=${mode}&untuk=${encodeURIComponent(target)}&kembali=${encodeURIComponent('/struk?id=r1')}`);
    await renderWithProviders(<LocationScreen />);
  };

  it('langkah 1: semua toko (REST, PRIBADI untuk toko privat) + "Terakhir dipakai" (R17) + search ilike', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pilih toko & cabang');
    const rows = await screen.findAllByTestId('store-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'AEON',
      'Alfamart',
      'Alfamidi',
      'Shopeeonline',
      'Toko Makmur JayaPRIBADI',
    ]);
    const recent = await screen.findAllByTestId('recent-location');
    const r17 = fx<{ store: { name: string }; branch: { name: string } | null }[]>('recent_locations');
    expect(recent.map((r) => r.textContent)).toEqual(r17.map((r) => `${r.store.name}${r.branch?.name ?? ''}`));
    const call = state.restCalls.find((c) => c.table === 'store')!;
    expect(call.calls).toEqual([
      ['select', ['id,name,channel,household_id']],
      ['eq', ['status', 'active']],
      ['order', ['name']],
      ['limit', [50]],
    ]);
    await userEvent.setup().type(screen.getByLabelText('Cari toko'), 'Aéon ');
    await waitFor(() =>
      expect(state.restCalls.some((c) => c.calls.some(([m, a]) => m === 'ilike' && a[1] === '*aeon*'))).toBe(true),
    );
  });

  it('terakhir dipakai (toko + cabang) → selesai langsung; hasil ke layar asal lewat replace(kembali)', async () => {
    await open();
    await userEvent.setup().click((await screen.findAllByTestId('recent-location'))[0]!.querySelector('button')!);
    expect(nav.replace).toHaveBeenCalledWith('/struk?id=r1');
    const first = fx<{ store: { id: string }; branch: { name: string } }[]>('recent_locations')[0]!;
    expect(takeLocationPick(target)).toMatchObject({
      store: { id: first.store.id },
      branch: { name: first.branch.name },
    });
  });

  it('dibuka dari layar asal (openLocationHref) → kembali dengan router.back()', async () => {
    openLocationHref('koreksi', target, '/struk?id=r1');
    await open();
    await userEvent.setup().click((await screen.findAllByTestId('recent-location'))[0]!.querySelector('button')!);
    expect(nav.back).toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('langkah 2: cabang (REST, tutup di bawah + "(tutup)"), "Tidak tahu cabangnya" (U-14) → branch null', async () => {
    await open('manual');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Label ini dari mana?');
    const user = userEvent.setup();
    await user.click(within((await screen.findAllByTestId('store-row'))[0]!).getByRole('button'));
    expect(screen.getByText('Langkah 2 dari 2 · Cabang di AEON')).toBeTruthy();
    const branches = await screen.findAllByTestId('branch-row');
    expect(branches.map((b) => b.textContent)).toEqual(['AEON BSDTangerang', 'AEON LamaTangerang(tutup)']);
    const call = state.restCalls.find((c) => c.table === 'branch')!;
    expect(call.calls).toEqual([
      ['select', ['id,name,city,region,kind,status,household_id,store_id']],
      ['eq', ['store_id', AEON]],
      ['order', ['status']],
      ['order', ['name']],
    ]);
    await user.click(screen.getByRole('button', { name: 'Tidak tahu cabangnya' }));
    expect(takeLocationPick(target)).toEqual({
      store: { id: AEON, name: 'AEON', channel: 'offline', is_private: false },
      branch: null,
    });
  });

  it('"+ Toko baru" → W17 dengan id dari klien (privat D-29) → langkah 2; "+ Cabang baru" → W17 → selesai', async () => {
    await open();
    const user = userEvent.setup();
    await screen.findAllByTestId('store-row');
    await user.click(screen.getByRole('button', { name: '+ Toko baru' }));
    await user.type(screen.getByLabelText('Nama toko'), 'Toko Makmur Jaya');
    await user.click(screen.getByRole('button', { name: 'Tambah toko' }));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('create_private_store', {
        p_store: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'Toko Makmur Jaya', channel: 'offline' },
      }),
    );
    expect(await screen.findByText('Langkah 2 dari 2 · Cabang di Toko Makmur Jaya')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '+ Cabang baru' }));
    await user.type(screen.getByLabelText('Nama cabang'), 'Pasar Modern');
    await user.type(screen.getByLabelText('Kota (opsional)'), 'Tangerang');
    await user.click(screen.getByRole('button', { name: 'Tambah cabang' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/struk?id=r1'));
    const store = sb.rpc.mock.calls.find(([fn]) => fn === 'create_private_store')![1] as { p_store: { id: string } };
    expect(sb.rpc).toHaveBeenCalledWith('create_private_branch', {
      p_branch: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        store_id: store.p_store.id,
        kind: 'physical',
        name: 'Pasar Modern',
        city: 'Tangerang',
      },
    });
    expect(takeLocationPick(target)).toMatchObject({ branch: { name: 'Pasar Modern', is_private: true } });
  });

  it('W17 23505 (id klien sudah ada) = sukses', async () => {
    state.rpcOverride = (fn) =>
      fn === 'create_private_store'
        ? { data: null, error: { message: 'duplicate key', code: '23505', details: null, hint: null } }
        : undefined;
    await open();
    const user = userEvent.setup();
    await screen.findAllByTestId('store-row');
    await user.click(screen.getByRole('button', { name: '+ Toko baru' }));
    await user.type(screen.getByLabelText('Nama toko'), 'Warung Bu Sri');
    await user.click(screen.getByRole('button', { name: 'Tambah toko' }));
    expect(await screen.findByText('Langkah 2 dari 2 · Cabang di Warung Bu Sri')).toBeTruthy();
  });

  it('kosong: "Belum ada toko terakhir." (R17 user baru); nama wajib di toko baru', async () => {
    state.rpcOverride = (fn) =>
      fn === 'recent_locations' ? { data: fx('recent_locations_empty'), error: null } : undefined;
    await open();
    expect(await screen.findByText('Belum ada toko terakhir.')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+ Toko baru' }));
    await user.click(screen.getByRole('button', { name: 'Tambah toko' }));
    expect(screen.getByText('Tulis namanya dulu.')).toBeTruthy();
    expect(sb.rpc).not.toHaveBeenCalledWith('create_private_store', expect.anything());
  });

  it('gagal REST store → pesan + Coba lagi', async () => {
    state.rest.store = () => ({ data: null, error: { message: 'boom', code: 'PT500', details: null, hint: null } });
    await open();
    expect(await screen.findByText('Terjadi kesalahan. Coba lagi sebentar lagi.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Coba lagi' }).length).toBeGreaterThan(0);
  });

  it('mode sesi = M4: pesan, tanpa daftar', async () => {
    await open('sesi');
    expect(screen.getByText('Memulai sesi belanja dibuat di milestone berikutnya (M4).')).toBeTruthy();
    expect(screen.queryByTestId('store-row')).toBeNull();
  });
});

describe('S-14 Pilih produk', () => {
  const base = {
    open: true,
    onClose: vi.fn(),
    createOpen: false,
    onCreateOpen: vi.fn(),
    onCreateClose: vi.fn(),
  };

  it('prefill + hasil R3 (≥ 2 huruf), peringatan beda ukuran per hasil, "+ Buat produk baru"', async () => {
    const onPick = vi.fn();
    await renderWithProviders(
      <ProductPicker {...base} initialQuery="milo" contextText="MILO ORI 200G" onPick={onPick} />,
    );
    const results = await screen.findAllByTestId('pick-result', {}, { timeout: 3000 });
    expect(sb.rpc).toHaveBeenCalledWith('search_products', { p_query: 'milo' });
    const milo500 = results.find((r) => /Milo Original 500 g/.test(r.textContent ?? ''))!;
    expect(within(milo500).getByTestId('size-mismatch').textContent).toBe('Teks menyebut 200G, produk ini 500 g.');
    const milo200 = results.find((r) => /Milo Original 200 g/.test(r.textContent ?? ''))!;
    expect(within(milo200).queryByTestId('size-mismatch')).toBeNull();
    await userEvent.setup().click(within(milo200).getByRole('button'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: '70000000-0000-0000-0000-000000000200' }));
    expect(screen.getByRole('button', { name: '+ Buat produk baru' })).toBeTruthy();
  });

  it('kosong: "Tidak ditemukan"; < 2 huruf: petunjuk; barcode dari scan (D-85)', async () => {
    const view = await renderWithProviders(
      <ProductPicker {...base} initialQuery="milo actv xyz" onPick={vi.fn()} barcode="1234567890123" />,
    );
    expect(await screen.findByTestId('pick-empty', {}, { timeout: 3000 })).toBeTruthy();
    expect(
      screen.getByText(
        'Barcode 1234567890123 belum dikenal. Cari produknya, atau buat produk baru dengan barcode ini.',
      ),
    ).toBeTruthy();
    view.unmount();
    await renderWithProviders(<ProductPicker {...base} initialQuery="m" onPick={vi.fn()} />);
    expect(screen.getByText('Ketik minimal 2 huruf untuk mencari.')).toBeTruthy();
  });
});

describe('S-15 Produk baru', () => {
  it('validasi zod dari kontrak: nama + ukuran kemasan; pratinjau multipack + harga per satuan (unitPrice)', async () => {
    const onCreated = vi.fn();
    await renderWithProviders(<NewProductForm onCreated={onCreated} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Simpan produk' }));
    expect(await screen.findByText('Tulis nama produk.')).toBeTruthy();
    expect(screen.getAllByText('Isi ukuran kemasan untuk produk yang dijual per kemasan.').length).toBeGreaterThan(0);
    expect(sb.rpc).not.toHaveBeenCalledWith('create_private_product', expect.anything());
    await user.type(screen.getByLabelText('Nama'), 'Kopi Sachet');
    await user.clear(screen.getByLabelText('Jumlah isi'));
    await user.type(screen.getByLabelText('Jumlah isi'), '10');
    await user.type(screen.getByLabelText('Ukuran per isi'), '20');
    const preview = screen.getByTestId('preview');
    expect(preview.textContent).toMatch(/Kopi Sachet · 10 × 20 g · harga per gram akan dihitung/);
    expect(preview.textContent).toMatch(/10 × 20 g = 200 g/);
    expect(within(preview).getByTestId('preview-unit-price').textContent).toBe('Contoh: Rp10.000 → Rp50/g');
  });

  it('timbang: tanpa ukuran, satuan harga per kg', async () => {
    await renderWithProviders(<NewProductForm onCreated={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Timbang' }));
    expect(screen.queryByLabelText('Ukuran per isi')).toBeNull();
    expect((screen.getByLabelText('Harga per') as HTMLSelectElement).value).toBe('kg');
    expect(screen.getByTestId('preview').textContent).toMatch(/dijual per kg/);
  });

  it('W8 sukses (keluaran asli) → onCreated; brand baru {new}, kategori REST, barcode gtin, id dari klien', async () => {
    const onCreated = vi.fn();
    await renderWithProviders(<NewProductForm onCreated={onCreated} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nama'), 'Gula Aren Bubuk');
    await user.type(screen.getByLabelText('Brand (opsional)'), 'Kebun Sari');
    expect(screen.getByText('Brand baru "Kebun Sari" dibuat sebagai PRIBADI.')).toBeTruthy();
    const cat = fx<{ id: string; name: string }[]>('rest_categories').find((c) => c.name === 'Makanan')!;
    await waitFor(() => expect(screen.getByRole('option', { name: 'Makanan' })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Kategori (opsional)'), cat.id);
    await user.type(screen.getByLabelText('Ukuran per isi'), '250');
    await user.type(screen.getByLabelText('Barcode 1'), '8990000000017');
    await user.click(screen.getByRole('button', { name: 'Simpan produk' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0]![0].product.is_private).toBe(true);
    expect(sb.rpc).toHaveBeenCalledWith('create_private_product', {
      p_product: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: 'Gula Aren Bubuk',
        variant: null,
        sale_mode: 'unit',
        pack_count: 1,
        content_size: 250,
        content_unit: 'g',
        category_id: cat.id,
        brand: { new: 'Kebun Sari' },
        group: 'same_as_name',
        barcodes: [{ code: '8990000000017', code_type: 'gtin' }],
      },
    });
  });

  it('23P01 (W8 asli) → pesan barcode + fokus; 23514 → pesan ukuran', async () => {
    state.rpcOverride = (fn) => (fn === 'create_private_product' ? err('create_product_23P01') : undefined);
    await renderWithProviders(<NewProductForm onCreated={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nama'), 'Gula Aren Cair');
    await user.type(screen.getByLabelText('Ukuran per isi'), '250');
    await user.type(screen.getByLabelText('Barcode 1'), '8990000000017');
    await user.click(screen.getByRole('button', { name: 'Simpan produk' }));
    expect((await screen.findByTestId('product-error')).textContent).toBe(
      'Barcode ini sudah dipakai produk lain di periode yang sama.',
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Barcode 1')));
    state.rpcOverride = (fn) => (fn === 'create_private_product' ? err('create_product_23514') : undefined);
    await user.click(screen.getByRole('button', { name: 'Simpan produk' }));
    await waitFor(() =>
      expect(screen.getByTestId('product-error').textContent).toBe(
        'Isi ukuran kemasan untuk produk yang dijual per kemasan.',
      ),
    );
  });

  it('"Produk serupa sudah ada" (R3) dengan "Pakai …" dari S-14', async () => {
    const onUse = vi.fn();
    await renderWithProviders(<NewProductForm initialName="milo" onCreated={vi.fn()} onUseExisting={onUse} />);
    const similar = await screen.findByTestId('similar', {}, { timeout: 3000 });
    expect(similar.textContent).toMatch(/Produk serupa sudah ada:/);
    await userEvent.setup().click(within(similar).getAllByRole('button')[0]!);
    expect(onUse).toHaveBeenCalled();
  });

  it('/produk/baru dari scan (D-85): S-14 dengan kode terisi → "+ Buat produk baru" → form dengan barcode', async () => {
    setUrl('/produk/baru', 'barcode=1234567890123&pilih=produk&untuk=barcode');
    await renderWithProviders(<NewProductScreen />);
    expect(await screen.findByTestId('product-picker')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: '+ Buat produk baru' }));
    expect(nav.replace).toHaveBeenCalledWith('/produk/baru?barcode=1234567890123', { scroll: false });
    expect((screen.getByLabelText('Barcode 1') as HTMLInputElement).value).toBe('1234567890123');
    expect(screen.getByText('Barcode 1234567890123 diisi dari hasil scan.')).toBeTruthy();
  });
});
