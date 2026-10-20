// docs/07 §8.1 no. 5: setiap ErrorCode wajib punya pesan. Test ini gagal jika kode baru
// ditambahkan ke packages/contracts tanpa entri di lib/copy/id.ts.
import { ERROR_CODES } from '@priceatlas/contracts';
import { describe, expect, it } from 'vitest';
import { CAPTURE_ERROR_COPY, ERROR_COPY, ROUTE_ERROR_COPY, SQLSTATE_COPY, fill } from '@/lib/copy/id';

describe('pesan error (§8.2)', () => {
  it('setiap ErrorCode kontrak punya pesan', () => {
    const missing = ERROR_CODES.filter((c) => !ERROR_COPY[c]?.message?.trim());
    expect(missing).toEqual([]);
  });

  it('tidak ada pesan untuk kode yang tidak ada di kontrak', () => {
    expect(Object.keys(ERROR_COPY).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('SQLSTATE bawaan yang dipakai kontrak (§3.1) punya pesan', () => {
    for (const s of ['42501', '22023', '23503', '23505', '23514', '23P01', 'P0001']) {
      expect(SQLSTATE_COPY[s]?.message, s).toBeTruthy();
    }
  });

  it('Route hapus akun dan alasan gagal proses (§8.3) lengkap', () => {
    expect(Object.keys(ROUTE_ERROR_COPY).sort()).toEqual(['DELETE_FAILED', 'DELETE_INCOMPLETE']);
    // Sama dengan app.fail_run (capture.error_code, D-71).
    expect(Object.keys(CAPTURE_ERROR_COPY).sort()).toEqual([
      'blurry',
      'not_a_receipt',
      'other',
      'timeout',
      'unsupported',
    ]);
  });

  it('pesan per layar sesuai tabel', () => {
    expect(ERROR_COPY.INVALID_STATE.byScreen?.['S-19c']).toBe(
      'Nyalakan berbagi harga dulu sebelum membagikan data lama.',
    );
    expect(ERROR_COPY.STALE_WRITE.message).toMatch(/^Data ini baru saja berubah/);
  });

  it('fill mengisi placeholder dan membiarkan yang tidak dikenal', () => {
    expect(fill(ERROR_COPY.UNDECIDED_LINES.message, { n: 3 })).toMatch(/^Masih ada 3 barang/);
    expect(fill('{a} {b}', { a: 1 })).toBe('1 {b}');
  });
});
