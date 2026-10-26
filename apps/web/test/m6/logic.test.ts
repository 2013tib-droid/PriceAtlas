// L5a M6: logika program member (S-00c/S-19b), keluar + hapus akun (Q-61, D-76), barcode S-15 edit
// (D-89), dan tujuan onboarding (S-00b/S-00c). Data dari fixture RPC/REST ASLI (test/fixtures/rpc.json).
import type { MyProgram } from '@priceatlas/contracts';
import { describe, expect, it } from 'vitest';
import {
  alreadyListed,
  barcodeError,
  barcodeFormSchema,
  defaultBarcodeForm,
  sortBarcodes,
  toBarcodeInsert,
} from '@/lib/catalog/barcodes';
import { ERROR_COPY, GENERIC_COPY, NEW_PRODUCT_COPY, ROUTE_ERROR_COPY, SQLSTATE_COPY } from '@/lib/copy/id';
import { fromRpcError } from '@/lib/data/errors';
import type { BarcodeRow } from '@/lib/data/rest-schemas';
import {
  deleteOutcome,
  isDeleteConfirmed,
  membershipError,
  shareError,
  signOutWarning,
  unsentPhotoCount,
} from '@/lib/settings/account';
import { afterOnboarding, memberStepHref, welcomeHref } from '@/lib/settings/onboarding';
import {
  canToggle,
  groupByStore,
  initialSelection,
  memberSummary,
  programsToJoin,
  toggleSelection,
} from '@/lib/settings/programs';
import { fx } from '../m1/harness';

const rpcErr = (key: string) => fromRpcError(fx<{ error: { message: string } }>(key).error);
const OLD = '40000000-0000-0000-0000-000000000003';
const AEON = '40000000-0000-0000-0000-000000000001';
const ALFA = '40000000-0000-0000-0000-000000000002';

describe('program member (R21 asli)', () => {
  const programs = fx<MyProgram[]>('programs');

  it('dikelompokkan per toko tanpa mengubah urutan R21', () => {
    const groups = groupByStore(programs);
    expect(groups.map((g) => g.storeName)).toEqual(['AEON', 'Alfamart']);
    expect(groups[0]!.programs.map((p) => p.program_id)).toEqual([OLD, AEON]);
    expect(groups.flatMap((g) => g.programs)).toEqual(programs);
  });

  it('program dihentikan: tidak bisa ditandai, tetapi keanggotaan lama boleh dilepas', () => {
    const old = programs.find((p) => p.program_id === OLD)!;
    expect(canToggle(old)).toBe(false);
    expect(canToggle({ ...old, is_member: true })).toBe(true);
    expect(canToggle(programs.find((p) => p.program_id === AEON)!)).toBe(true);
  });

  it('ringkasan S-19: belum ada / jumlah + nama (maks 2)', () => {
    expect(memberSummary(undefined)).toBe('Belum ada yang diikuti');
    expect(memberSummary(fx<MyProgram[]>('programs_member'))).toBe('1 diikuti: AEON Member');
    const three = programs.map((p) => ({ ...p, is_member: true }));
    expect(memberSummary(three)).toBe('3 diikuti: AEON Lama Club, AEON Member dan 1 lainnya');
  });

  it('S-00c: pilihan awal = keanggotaan; program dihentikan tidak bisa dipilih; hanya yang baru di-W16', () => {
    const member = fx<MyProgram[]>('programs_member');
    let sel = initialSelection(member);
    expect([...sel]).toEqual([AEON]);
    sel = toggleSelection(
      sel,
      member.find((p) => p.program_id === OLD)!,
    );
    expect(sel.has(OLD)).toBe(false);
    sel = toggleSelection(
      sel,
      member.find((p) => p.program_id === ALFA)!,
    );
    expect(programsToJoin(sel, member)).toEqual([ALFA]);
    sel = toggleSelection(
      sel,
      member.find((p) => p.program_id === ALFA)!,
    );
    expect(programsToJoin(sel, member)).toEqual([]);
  });

  it('W16 INVALID_STATE (program dihentikan) → pesan S-19b', () => {
    expect(membershipError(rpcErr('member_discontinued'))).toBe(
      'Program ini sudah dihentikan dan tidak bisa ditandai.',
    );
  });
});

describe('berbagi publik (W14/W15 asli)', () => {
  it('W15 saat mati → pesan S-19c; FORBIDDEN → pesan izin', () => {
    expect(shareError(rpcErr('share_existing_off'))).toBe('Nyalakan berbagi harga dulu sebelum membagikan data lama.');
    expect(shareError(fromRpcError({ message: 'FORBIDDEN', code: 'PT403' }))).toBe(ERROR_COPY.FORBIDDEN.message);
  });
});

describe('keluar + hapus akun', () => {
  it('Q-61: foto belum terdaftar dihitung per bagian; yang sudah terkirim tidak', () => {
    const items = [
      { state: 'waiting_network' as const, parts: [{}, {}] },
      { state: 'captured' as const, parts: [] },
      { state: 'submitted' as const, parts: [{}] },
    ] as Parameters<typeof unsentPhotoCount>[0];
    expect(unsentPhotoCount(items)).toBe(3);
    expect(signOutWarning(3)).toBe('3 foto belum terunggah dan akan dihapus. Tetap keluar?');
    expect(signOutWarning(0)).toBeNull();
  });

  it('teks konfirmasi harus persis HAPUS AKUN (spasi tepi diabaikan)', () => {
    expect(isDeleteConfirmed('HAPUS AKUN')).toBe(true);
    expect(isDeleteConfirmed('  HAPUS   AKUN ')).toBe(true);
    expect(isDeleteConfirmed('hapus akun')).toBe(false);
    expect(isDeleteConfirmed('HAPUS')).toBe(false);
  });

  it('respons route hapus akun: 202 / REAUTH_REQUIRED / DELETE_FAILED / DELETE_INCOMPLETE / lainnya', () => {
    expect(deleteOutcome(202, { status: 'accepted' })).toEqual({ kind: 'done' });
    expect(deleteOutcome(401, { error: 'REAUTH_REQUIRED' })).toEqual({
      kind: 'reauth',
      message: ERROR_COPY.REAUTH_REQUIRED.message,
    });
    expect(deleteOutcome(500, { error: 'DELETE_FAILED' })).toEqual({
      kind: 'retry',
      message: ROUTE_ERROR_COPY.DELETE_FAILED.message,
    });
    expect(deleteOutcome(500, { error: 'DELETE_INCOMPLETE' })).toEqual({
      kind: 'retry',
      message: ROUTE_ERROR_COPY.DELETE_INCOMPLETE.message,
    });
    expect(deleteOutcome(502, null)).toEqual({ kind: 'retry', message: GENERIC_COPY.unknown.message });
  });
});

describe('barcode S-15 edit (REST barcode_assignment asli, D-89)', () => {
  const plu = fx<BarcodeRow[]>('barcodes_plu');

  it('validasi sama dengan S-15 baru: GTIN 8–14 angka; PLU 1–14 angka + toko', () => {
    expect(barcodeFormSchema.safeParse({ code_type: 'gtin', code: '8991234500017', store_id: '' }).success).toBe(true);
    const bad = barcodeFormSchema.safeParse({ code_type: 'gtin', code: '123', store_id: '' });
    expect(bad.success ? null : bad.error.issues[0]!.message).toBe(NEW_PRODUCT_COPY.errors.barcode);
    const noStore = barcodeFormSchema.safeParse({ code_type: 'plu', code: '2101', store_id: '' });
    expect(noStore.success ? [] : noStore.error.issues.map((i) => i.path[0])).toEqual(['store_id']);
    expect(defaultBarcodeForm('weight').code_type).toBe('plu');
    expect(defaultBarcodeForm('unit').code_type).toBe('gtin');
  });

  it('insert: id klien, kode di-trim, store_id hanya untuk PLU', () => {
    expect(toBarcodeInsert({ code_type: 'gtin', code: ' 8991234500017 ', store_id: 'x' }, 'p', 'id1')).toEqual({
      id: 'id1',
      product_id: 'p',
      code: '8991234500017',
      code_type: 'gtin',
      store_id: null,
    });
    const s = plu[0]!.store_id!;
    expect(toBarcodeInsert({ code_type: 'plu', code: '2001', store_id: s }, 'p', 'id2').store_id).toBe(s);
  });

  it('kode yang sudah aktif di produk ini dikenali sebelum dikirim', () => {
    const s = plu[0]!.store_id!;
    expect(alreadyListed({ code_type: 'plu', code: '2001', store_id: s }, plu)).toBe(true);
    expect(alreadyListed({ code_type: 'plu', code: '2001', store_id: 'lain' }, plu)).toBe(false);
    expect(alreadyListed({ code_type: 'gtin', code: '8991234500017', store_id: '' }, fx('barcodes_big'))).toBe(true);
  });

  it('urutan: aktif dulu, terbaru di atas', () => {
    const rows = [
      { ...plu[0]!, id: 'a', code: '1', valid_from: '2026-01-01', valid_until: '2026-02-01' },
      { ...plu[0]!, id: 'b', code: '2', valid_from: '2026-01-01', valid_until: null },
      { ...plu[0]!, id: 'c', code: '3', valid_from: '2026-03-01', valid_until: null },
    ];
    expect(sortBarcodes(rows).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('error insert asli: 23P01, 23514, 42501 (produk global)', () => {
    expect(barcodeError(rpcErr('barcode_insert_23P01'))).toEqual({
      message: SQLSTATE_COPY['23P01']!.message,
      field: 'code',
    });
    expect(barcodeError(rpcErr('barcode_insert_23514')).field).toBe('code');
    expect(barcodeError(rpcErr('barcode_insert_global'))).toEqual({
      message: 'Produk ini bukan milikmu.',
      field: null,
    });
  });
});

describe('onboarding (S-00b → S-00c)', () => {
  it('semua login lewat /selamat-datang dengan tujuan aman', () => {
    expect(welcomeHref(null)).toBe('/selamat-datang');
    expect(welcomeHref('/')).toBe('/selamat-datang');
    expect(welcomeHref('/unggahan')).toBe('/selamat-datang?next=%2Funggahan');
    expect(welcomeHref('//evil.example')).toBe('/selamat-datang');
    expect(memberStepHref('/produk?id=1')).toBe('/selamat-datang/member?next=%2Fproduk%3Fid%3D1');
  });

  it('tujuan akhir tidak pernah kembali ke onboarding', () => {
    expect(afterOnboarding('/unggahan')).toBe('/unggahan');
    expect(afterOnboarding('/selamat-datang/member')).toBe('/');
    expect(afterOnboarding('https://evil.example')).toBe('/');
    expect(afterOnboarding(null)).toBe('/');
  });
});
