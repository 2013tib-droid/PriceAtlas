// @vitest-environment jsdom
// L5b M3: S-10 Konfirmasi / detail struk di setiap keadaan §7.3, memakai keluaran R15/W4 ASLI
// (test/fixtures/rpc.json: struk-aeon, struk duplikat, struk tanpa toko + field ragu, struk tersimpan,
// confirm_receipt sukses / UNDECIDED_LINES / DUPLICATE_DECISION_REQUIRED / RECEIPT_STORE_REQUIRED).
// Keadaan yang tidak dihasilkan fixture worker (total selisih, void, timbang, multi-gambar, cabang tidak
// diketahui) diturunkan dari fixture asli dengan mengubah field yang relevan saja.
import '../m1/mocks';
import type { ReceiptDetail } from '@priceatlas/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  freezeToday,
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

const { ReceiptScreen } = await import('@/features/receipt/receipt-screen');
const { formatTransactionDate } = await import('@/lib/format');
const TZ = 'Asia/Jakarta';
const { completeLocationPick, openLocationHref } = await import('@/lib/confirm/location-handoff');

installDomPolyfills();

const err = (key: string) => ({ data: null, error: fx<{ error: unknown }>(key).error });
const receipt = (k: string) => fx<ReceiptDetail>(`receipt_${k}`);

beforeEach(async () => {
  await resetHarness();
  freezeToday();
});

async function open(key: 'aeon' | 'duplicate' | 'nostore', override?: (r: ReceiptDetail) => ReceiptDetail) {
  const id = m3Ids().receipts[key];
  setUrl('/struk', `id=${id}`);
  if (override) {
    const data = override(receipt(key));
    state.rpcOverride = (fn) => (fn === 'get_receipt' ? { data, error: null } : undefined);
  }
  const view = await renderWithProviders(<ReceiptScreen />);
  await screen.findByTestId('receipt-screen');
  return { ...view, id };
}
const needsRows = () => screen.getAllByTestId('needs-check-line');
const saveBtn = () => screen.getByTestId('save-receipt') as HTMLButtonElement;

describe('S-10 keadaan dasar', () => {
  it('memuat: skeleton tanpa spinner tengah', async () => {
    setUrl('/struk', `id=${m3Ids().receipts.aeon}`);
    state.rpcOverride = (fn) => (fn === 'get_receipt' ? new Promise(() => undefined) : undefined);
    await renderWithProviders(<ReceiptScreen />);
    expect(screen.getByRole('status').textContent).toBe('Memuat…');
  });

  it('NOT_FOUND (R15 asli) → pesan + kembali ke Unggahan', async () => {
    setUrl('/struk', 'id=99999999-0000-0000-0000-000000000000');
    await renderWithProviders(<ReceiptScreen />);
    expect(await screen.findByText('Data ini tidak ditemukan. Mungkin sudah dihapus.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Kembali ke Unggahan' })).toBeTruthy();
  });

  it('normal (struk-aeon): header, cek total ✓, perlu dicek (2) di atas, lipatan, PII, "Simpan 1 harga"', async () => {
    await open('aeon');
    const header = screen.getByTestId('receipt-header');
    expect(header.textContent).toMatch(/AEON · AEON BSD/);
    expect(header.textContent).toMatch(`${formatTransactionDate('2026-10-15', TZ)} · 19:02`);
    expect(header.textContent).toMatch(/\(diunggah hari ini\)/);
    expect(screen.getByTestId('totals-check').textContent).toBe('Total struk Rp114.700 · jumlah item Rp114.700 ✓');
    expect(screen.getByRole('heading', { name: 'Perlu dicek (2)' })).toBeTruthy();
    const [indomie, snack] = needsRows();
    expect(indomie!.textContent).toMatch(/"INDOMIE GRG 85G"/);
    expect(indomie!.textContent).toMatch(/→ Indomie Goreng 85 g\?ragu/);
    expect(indomie!.textContent).toMatch(/5 × Rp3.500/);
    expect(snack!.textContent).toMatch(/→ Milo 3in1 10 × 35 g\?ragu/);
    // Kuantitas + diskon menempel (D-63) di lipatan tersimpan otomatis.
    const auto = screen.getByTestId('fold-auto');
    expect(within(auto).getByText('Tersimpan otomatis (1)')).toBeTruthy();
    expect(auto.textContent).toMatch(/MILO ORI 500G → Milo Original 500 g/);
    expect(auto.textContent).toMatch(/Rp42.500PROMO/);
    expect(screen.getByTestId('fold-nonproduct').textContent).toMatch(/KANTONG PLASTIK · Rp200/);
    expect(screen.queryByTestId('fold-adjustments')).toBeNull();
    expect(screen.getByText('Nomor kartu dan data pribadi di struk disamarkan.')).toBeTruthy();
    expect(screen.queryByText(/Benarkan semua saran/)).toBeNull(); // hanya 2 (< 3, U-12)
    expect(saveBtn().textContent).toBe('Simpan 1 harga');
  });

  it('member hint (DISC MEMBER, U-21): "Ya, tandai" → W16 dengan program AEON, kotak hilang', async () => {
    await open('aeon');
    const box = screen.getByTestId('member-hint');
    expect(box.textContent).toMatch(/Struk ini memakai harga member AEON\. Kamu member AEON\?/);
    await userEvent.setup().click(within(box).getByRole('button', { name: 'Ya, tandai' }));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('set_program_membership', {
        p_program_id: receipt('aeon').member_hint!.program_id,
        p_member: true,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('member-hint')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Keanggotaan ditandai. Harga lain yang sudah tersimpan tidak berubah.');
  });
});

describe('S-10 keputusan dan simpan (W4)', () => {
  it('Benar + Bukan produk → "Simpan 2 harga" → W4 p_lines asli → toast "3 harga baru tersimpan" + ringkasan', async () => {
    const { id } = await open('aeon');
    const user = userEvent.setup();
    const [indomie, snack] = needsRows();
    await user.click(within(indomie!).getByRole('button', { name: 'Benar' }));
    expect(within(indomie!).getByTestId('alias-learned').textContent).toBe(
      "Selanjutnya 'INDOMIE GRG 85G' di AEON dikenali otomatis.",
    );
    await user.click(within(snack!).getByRole('button', { name: 'Bukan produk' }));
    expect(within(snack!).getByTestId('line-decided').textContent).toMatch(/Bukan produk/);
    expect(saveBtn().textContent).toBe('Simpan 2 harga');
    await user.click(saveBtn());
    const lines = groupIds();
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('confirm_receipt', {
        p_receipt_id: id,
        p_lines: [
          { line_id: lines.indomie, action: 'accept' },
          { line_id: lines.snack, action: 'non_product' },
        ],
        p_duplicate_decision: null,
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('3 harga baru tersimpan'));
    expect(await screen.findByTestId('summary-updating')).toBeTruthy();
    expect(sb.rpc).toHaveBeenCalledWith('get_product_cards', expect.anything());
  });

  it('Ganti → S-14 (lapisan ?pilih=produk&untuk=line:…, prefill raw_text) → pilih → "Diganti: …"', async () => {
    const lines = groupIds();
    setUrl('/struk', `id=${m3Ids().receipts.aeon}`);
    const view = await renderWithProviders(<ReceiptScreen />);
    await screen.findByTestId('receipt-screen');
    const user = userEvent.setup();
    await user.click(within(needsRows()[1]!).getByRole('button', { name: 'Ganti produk' }));
    expect(nav.push).toHaveBeenCalledWith(
      `/struk?id=${m3Ids().receipts.aeon}&pilih=produk&untuk=line%3A${lines.snack}`,
      {
        scroll: false,
      },
    );
    // Router tiruan: URL lapisan dipasang manual, layar dirender ulang.
    setUrl('/struk', `id=${m3Ids().receipts.aeon}&pilih=produk&untuk=line:${lines.snack}`);
    view.rerenderUi(<ReceiptScreen />);
    const picker = await screen.findByTestId('product-picker');
    expect((screen.getByLabelText('Cari produk') as HTMLInputElement).value).toBe('SNACK XYZ');
    expect(within(picker).getByTestId('pick-suggestion').textContent).toMatch(/Milo 3in1/);
    await user.clear(screen.getByLabelText('Cari produk'));
    await user.type(screen.getByLabelText('Cari produk'), 'milo');
    const results = await within(picker).findAllByTestId('pick-result', {}, { timeout: 3000 });
    await user.click(within(results[0]!).getByRole('button'));
    setUrl('/struk', `id=${m3Ids().receipts.aeon}`);
    view.rerenderUi(<ReceiptScreen />);
    await waitFor(() => expect(within(needsRows()[1]!).getByTestId('line-decided').textContent).toMatch(/^Diganti: /));
  });

  it('⋯ → Tandai bundle + Benar → is_bundle; ⋯ → Lewati', async () => {
    const { id } = await open('aeon');
    const user = userEvent.setup();
    const [indomie, snack] = needsRows();
    await user.click(within(indomie!).getByRole('button', { name: 'Lainnya untuk INDOMIE GRG 85G' }));
    await user.click(within(indomie!).getByRole('button', { name: 'Tandai bundle' }));
    await user.click(within(indomie!).getByRole('button', { name: 'Benar' }));
    expect(indomie!.textContent).toMatch(/BUNDLE · tidak dihitung/);
    await user.click(within(snack!).getByRole('button', { name: 'Lainnya untuk SNACK XYZ' }));
    await user.click(within(snack!).getByRole('button', { name: 'Lewati' }));
    expect(within(snack!).getByTestId('line-decided').textContent).toMatch(/Dilewati \(tidak disimpan\)/);
    await user.click(saveBtn());
    const lines = groupIds();
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('confirm_receipt', {
        p_receipt_id: id,
        p_lines: [
          { line_id: lines.indomie, action: 'accept', is_bundle: true },
          { line_id: lines.snack, action: 'skip' },
        ],
        p_duplicate_decision: null,
      }),
    );
  });

  it('"Benarkan semua saran" muncul untuk ≥ 3 item dengan saran (U-12)', async () => {
    await open('aeon', (r) => {
      const t = r.lines.find((l) => l.raw_text === 'SNACK XYZ')!;
      return {
        ...r,
        lines: [...r.lines, { ...t, id: '00000000-0000-4000-8000-000000000099', line_no: 9, raw_text: 'COKLAT X' }],
      };
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Benarkan semua saran (3)' }));
    expect(screen.getAllByTestId('line-decided')).toHaveLength(3);
    expect(saveBtn().textContent).toBe('Simpan 4 harga');
  });

  it('UNDECIDED_LINES (W4 asli) → pesan jumlah + fokus ke baris pertama; pilihan tetap', async () => {
    await open('aeon');
    state.rpcOverride = (fn) => (fn === 'confirm_receipt' ? err('confirm_receipt_undecided') : undefined);
    const user = userEvent.setup();
    await user.click(saveBtn());
    const alert = await screen.findByTestId('save-error');
    expect(alert.textContent).toMatch(
      /Masih ada 2 barang yang belum diputuskan\. Pilih Benar, Ganti, Bukan produk, atau Lewati\./,
    );
    expect(alert.textContent).toMatch(/Pilihanmu tidak hilang/);
    await waitFor(() => expect(document.activeElement?.id).toBe(`line-${groupIds().indomie}`));
  });

  it('gagal jaringan: pilihan dipertahankan di memori + sessionStorage (muat ulang layar)', async () => {
    const { id, unmount } = await open('aeon');
    state.rpcOverride = (fn) =>
      fn === 'confirm_receipt' ? Promise.reject(new TypeError('Failed to fetch')) : undefined;
    const user = userEvent.setup();
    await user.click(within(needsRows()[0]!).getByRole('button', { name: 'Benar' }));
    await user.click(saveBtn());
    expect((await screen.findByTestId('save-error')).textContent).toMatch(/Tidak ada sinyal/);
    expect(screen.getAllByTestId('line-decided')).toHaveLength(1);
    expect(sessionStorage.getItem(`priceatlas:receipt-decisions:${id}`)).toMatch(/"accept"/);
    unmount();
    state.rpcOverride = null;
    await renderWithProviders(<ReceiptScreen />);
    await screen.findByTestId('receipt-screen');
    expect(screen.getAllByTestId('line-decided')).toHaveLength(1);
  });

  it('menyimpan: tombol "Menyimpan…" nonaktif', async () => {
    await open('aeon');
    state.rpcOverride = (fn) => (fn === 'confirm_receipt' ? new Promise(() => undefined) : undefined);
    await userEvent.setup().click(saveBtn());
    await waitFor(() => expect(saveBtn().textContent).toBe('Menyimpan…'));
    expect(saveBtn().disabled).toBe(true);
  });
});

describe('S-10 duplikat (D-20, D-74)', () => {
  it('banner struk lama (toko/tanggal/total R15); simpan nonaktif sampai memilih "Ini struk berbeda"', async () => {
    const { id } = await open('duplicate');
    const banner = screen.getByTestId('duplicate-banner');
    expect(banner.textContent).toMatch(/Mungkin duplikat: struk AEON 15 Okt 2026, total Rp114\.700 sudah ada\./);
    expect(saveBtn().disabled).toBe(true);
    const user = userEvent.setup();
    await user.click(within(banner).getByRole('button', { name: 'Ini struk berbeda' }));
    expect(banner.textContent).toMatch(/Disimpan sebagai struk berbeda/);
    expect(saveBtn().disabled).toBe(false);
    for (const row of needsRows()) {
      const b = within(row).queryByRole('button', { name: 'Benar' });
      if (b) await user.click(b);
    }
    await user.click(saveBtn());
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith(
        'confirm_receipt',
        expect.objectContaining({ p_receipt_id: id, p_duplicate_decision: 'distinct' }),
      ),
    );
  });

  it('"Buang yang ini" → konfirmasi → W4 discard → kembali ke Unggahan', async () => {
    const { id } = await open('duplicate');
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId('duplicate-banner')).getByRole('button', { name: 'Buang yang ini' }));
    await user.click(await screen.findByRole('button', { name: 'Buang' }));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('confirm_receipt', {
        p_receipt_id: id,
        p_lines: [],
        p_duplicate_decision: 'discard',
      }),
    );
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/unggahan'));
  });

  it('DUPLICATE_DECISION_REQUIRED dari server (W4 asli) → pesan dengan struk lama + fokus banner', async () => {
    await open('duplicate');
    state.rpcOverride = (fn, a) => {
      if (fn === 'confirm_receipt') return err('confirm_receipt_duplicate');
      if (fn === 'get_receipt' && a.p_receipt_id === m3Ids().receipts.duplicate)
        return { data: receipt('duplicate'), error: null };
      return undefined;
    };
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId('duplicate-banner')).getByRole('button', { name: 'Ini struk berbeda' }));
    await user.click(saveBtn());
    expect((await screen.findByTestId('save-error')).textContent).toMatch(
      /Struk ini mirip struk AEON 15 Okt 2026, total Rp114\.700\. Pilih dulu/,
    );
  });

  it('"Lihat" membuka S-10 struk lama', async () => {
    await open('duplicate');
    await userEvent
      .setup()
      .click(within(screen.getByTestId('duplicate-banner')).getByRole('button', { name: 'Lihat' }));
    expect(nav.push).toHaveBeenCalledWith(`/struk?id=${receipt('duplicate').duplicate!.receipt_id}`);
  });
});

describe('S-10 toko & header', () => {
  it('toko belum dikenali + field ragu (date 0,62 < τ): "Pilih toko" → S-12 mode koreksi; simpan → pesan + aksi', async () => {
    const { id } = await open('nostore');
    expect(screen.getByTestId('store-unknown').textContent).toMatch(/Toko belum dikenali/);
    expect(screen.getByTestId('receipt-header').textContent).toMatch(`${formatTransactionDate('2026-10-14', TZ)}ragu`);
    const user = userEvent.setup();
    await user.click(saveBtn());
    expect((await screen.findByTestId('save-error')).textContent).toMatch(
      /Pilih toko untuk struk ini sebelum menyimpan/,
    );
    await user.click(within(screen.getByTestId('store-unknown')).getByRole('button', { name: 'Pilih toko' }));
    expect(nav.push).toHaveBeenCalledWith(`/lokasi?mode=koreksi&untuk=receipt%3A${id}&kembali=%2Fstruk%3Fid%3D${id}`);
    // Voucher & poin (info, tidak mengurangi harga item).
    expect(screen.getByTestId('fold-adjustments').textContent).toMatch(/Poin \+37/);
  });

  it('RECEIPT_STORE_REQUIRED dari server (W4 asli) → pesan + "Pilih toko"', async () => {
    await open('nostore', (r) => ({ ...r, header: { ...r.header, store: receipt('aeon').header.store } }));
    state.rpcOverride = (fn) =>
      fn === 'confirm_receipt'
        ? err('confirm_receipt_nostore')
        : fn === 'get_receipt'
          ? {
              data: {
                ...receipt('nostore'),
                header: { ...receipt('nostore').header, store: receipt('aeon').header.store },
              },
              error: null,
            }
          : undefined;
    const user = userEvent.setup();
    for (const row of needsRows()) await user.click(within(row).getByRole('button', { name: 'Bukan produk' }));
    await user.click(saveBtn());
    const alert = await screen.findByTestId('save-error');
    expect(alert.textContent).toMatch(/Pilih toko untuk struk ini sebelum menyimpan/);
    expect(within(alert).getByRole('button', { name: 'Pilih toko' })).toBeTruthy();
  });

  it('hasil S-12 (kembali=) → REST PATCH receipt store_id/branch_id dengan filter updated_at', async () => {
    const id = m3Ids().receipts.nostore;
    openLocationHref('koreksi', `receipt:${id}`, `/struk?id=${id}`);
    const store = receipt('aeon').header.store!;
    completeLocationPick(`receipt:${id}`, { store, branch: null });
    await open('nostore');
    await waitFor(() => expect(state.restCalls.some((c) => c.table === 'receipt')).toBe(true));
    const call = state.restCalls.find((c) => c.table === 'receipt')!;
    expect(call.calls).toEqual([
      ['update', [{ store_id: store.id, branch_id: null }]],
      ['eq', ['id', id]],
      ['eq', ['updated_at', receipt('nostore').header.updated_at]],
      ['select', ['id,updated_at']],
    ]);
    expect(toast.success).toHaveBeenCalledWith('Info struk diperbarui.');
  });

  it('✎ header: PATCH 0 baris → STALE_WRITE (pesan + muat ulang)', async () => {
    await open('aeon');
    state.rest.receipt = () => ({ data: [], error: null });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ubah info struk' }));
    const total = await screen.findByLabelText('Total struk');
    await user.clear(total);
    await user.type(total, '115000');
    await user.click(screen.getByRole('button', { name: 'Simpan info' }));
    expect(
      await screen.findAllByText(
        'Data ini baru saja berubah di tempat lain. Kami muat ulang versi terbaru; periksa lagi lalu simpan.',
      ),
    ).not.toHaveLength(0);
    const call = state.restCalls.find((c) => c.table === 'receipt')!;
    expect(call.calls[0]).toEqual(['update', [{ total_amount: 115000 }]]);
  });

  it('total tidak cocok = peringatan saja (D-50), simpan tetap aktif; cabang tidak diketahui → "Pilih"', async () => {
    await open('aeon', (r) => ({
      ...r,
      header: { ...r.header, branch: null },
      totals: { lines_sum: 111200, total_amount: 114700, diff: 3500 },
    }));
    expect(screen.getByTestId('totals-check').textContent).toBe(
      'Jumlah item Rp111.200 · total struk Rp114.700 · selisih Rp3.500. Mungkin ada baris yang terlewat.',
    );
    expect(screen.getByTestId('receipt-header').textContent).toMatch(/AEON · cabang tidak diketahui · Pilih/);
    expect(saveBtn().disabled).toBe(false);
  });

  it('multi-gambar ("bagian 1/2"), void dicoret, baris timbang', async () => {
    await open('aeon', (r) => {
      const indomie = r.lines.find((l) => l.raw_text === 'INDOMIE GRG 85G')!;
      const weightSug = {
        ...indomie.suggestion!,
        sale_mode: 'weight' as const,
        content_size: null,
        content_unit: 'kg',
      };
      return {
        ...r,
        images: [
          ...r.images,
          { ...r.images[0]!, position: 2, storage_path: r.images[0]!.storage_path.replace('1.jpg', '2.jpg') },
        ],
        lines: r.lines.map((l) =>
          l.id === indomie.id
            ? {
                ...l,
                raw_text: 'JERUK MEDAN',
                quantity: 0.535,
                unit_amount: 45000,
                line_amount: 24075,
                suggestion: weightSug,
              }
            : l.raw_text === 'SNACK XYZ'
              ? {
                  ...l,
                  attached: [
                    {
                      id: '00000000-0000-4000-8000-0000000000aa',
                      line_no: 6,
                      line_type: 'void' as const,
                      raw_text: 'VOID',
                      quantity: 1,
                      line_amount: -12000,
                      updated_at: l.updated_at,
                    },
                  ],
                }
              : l,
        ),
      };
    });
    expect(await screen.findByText('bagian 2/2')).toBeTruthy();
    const [jeruk, snack] = needsRows();
    expect(jeruk!.textContent).toMatch(/0,535 kg × Rp45.000\/kg = Rp24.075/);
    expect(snack!.textContent).toMatch(/\(dibatalkan di struk\)/);
  });

  it('semua item sudah dikenali: "Semua item sudah dikenali."', async () => {
    await open('aeon', (r) => ({ ...r, lines: r.lines.map((l) => ({ ...l, needs_check: false })) }));
    expect(screen.getByTestId('all-recognized').textContent).toBe('Semua item sudah dikenali.');
  });
});

describe('S-10 mode tersimpan (dibuka dari S-09 "Lihat struk")', () => {
  it('tanpa "perlu dicek" dan tanpa tombol simpan; koreksi baris → W7 dengan p_expected_updated_at', async () => {
    setUrl('/struk', `id=${m3Ids().receipts.aeon}`);
    state.rpcOverride = (fn) => (fn === 'get_receipt' ? { data: receipt('confirmed'), error: null } : undefined);
    await renderWithProviders(<ReceiptScreen />);
    expect((await screen.findByTestId('receipt-screen')).dataset.status).toBe('confirmed');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Struk');
    expect(screen.queryByTestId('needs-check-line')).toBeNull();
    expect(screen.queryByTestId('save-receipt')).toBeNull();
    expect(screen.queryByTestId('member-hint')).toBeNull();
    const saved = screen.getAllByTestId('saved-line');
    expect(saved).toHaveLength(3);
    const user = userEvent.setup();
    await user.click(within(saved[0]!).getByRole('button', { name: 'Koreksi' }));
    const qty = await screen.findByLabelText('Jumlah');
    await user.clear(qty);
    await user.type(qty, '3');
    await user.click(screen.getByRole('button', { name: 'Simpan koreksi' }));
    const line = receipt('confirmed').lines.find((l) => l.line_type === 'product')!;
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('correct_receipt_line', {
        p_line_id: line.id,
        p_patch: { quantity: 3 },
        p_expected_updated_at: line.updated_at,
      }),
    );
  });
});

function groupIds() {
  const r = receipt('aeon');
  const by = (t: string) => r.lines.find((l) => l.raw_text === t)!.id;
  return { indomie: by('INDOMIE GRG 85G'), snack: by('SNACK XYZ'), milo: by('MILO ORI 500G') };
}
