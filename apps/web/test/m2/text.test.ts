// L5a M2: teks S-08/S-09 (§8.3 error_code, U-11, U-17), CSP §11.6, ukuran antrean.
import { describe, expect, it } from 'vitest';
import {
  captureErrorAction,
  captureErrorText,
  localErrorText,
  localStatusText,
  statusAnnouncement,
} from '@/features/uploads/capture-text';
import { groupFiles } from '@/features/capture/gallery-dialog';
import { CAPTURE_ERROR_COPY } from '@/lib/copy/id';
import { formatBytes } from '@/lib/format';
import { newItem, type OutboxItem } from '@/lib/offline/outbox-store';
import { buildCsp } from '@/lib/security/csp';

const item = (over: Partial<OutboxItem>): OutboxItem => ({
  ...newItem({
    capture_id: 'x',
    kind: 'receipt',
    household_id: null,
    shopping_session_id: null,
    store_id: null,
    branch_id: null,
    captured_at: null,
    parts: [1, 2, 3].map((position) => ({
      position,
      ext: 'jpg',
      content_type: 'image/jpeg',
      sha256: 'a',
      byte_size: 1,
    })),
  }),
  ...over,
});

describe('§8.3 alasan gagal proses', () => {
  it('setiap error_code punya teks; other/null → error_message server atau cadangan', () => {
    expect(captureErrorText('blurry', 'x')).toBe('Gambar buram atau terpotong.');
    expect(captureErrorText('not_a_receipt', null)).toBe('Ini sepertinya bukan struk atau label harga.');
    expect(captureErrorText('unsupported', null)).toBe('Format gambar ini belum bisa dibaca.');
    expect(captureErrorText('timeout', null)).toBe('Pemrosesan terlalu lama. Coba ulangi.');
    expect(captureErrorText('other', 'Pesan server')).toBe('Pesan server');
    expect(captureErrorText(null, null)).toBe(CAPTURE_ERROR_COPY.other.message);
  });
  it('aksi utama: Foto ulang untuk buram/bukan struk/format, Ulangi untuk timeout/other', () => {
    expect(['blurry', 'not_a_receipt', 'unsupported', 'timeout', 'other', null].map(captureErrorAction)).toEqual([
      'retake',
      'retake',
      'retake',
      'retry',
      'retry',
      'retry',
    ]);
  });
});

describe('pengumuman status (U-11)', () => {
  const c = {
    id: 'a',
    kind: 'receipt' as const,
    status: 'done' as const,
    store_name: 'AEON',
    branch_name: 'AEON BSD',
    date: '2026-10-20',
    date_is_upload: false,
    needs_check_count: 0,
    saved_count: 14,
    error_message: null,
    error_code: null,
    attempts: 1,
    uploaded_at: '2026-10-20T05:00:00Z',
    receipt_id: null,
  };
  it('hanya transisi penting, tidak saat muat pertama', () => {
    expect(statusAnnouncement(undefined, c)).toBeNull();
    expect(statusAnnouncement('done', c)).toBeNull();
    expect(statusAnnouncement('processing', c)).toBe('Struk AEON BSD selesai diproses: 14 harga tersimpan.');
    expect(statusAnnouncement('processing', { ...c, status: 'needs_confirmation' })).toBe(
      'Struk AEON BSD perlu dicek.',
    );
    expect(statusAnnouncement('uploaded', { ...c, status: 'processing' })).toBeNull();
  });
});

describe('status antrean lokal', () => {
  it('uploading i/n, menunggu sinyal, F-24, sesi, error', () => {
    expect(localStatusText(item({ state: 'uploading', uploaded: [1] }))).toBe('Mengunggah 2/3…');
    expect(localStatusText(item({ state: 'waiting_network' }))).toBe('Menunggu sinyal');
    expect(
      localStatusText(item({ state: 'waiting_network', last_error: { kind: 'missing', code: null, message: null } })),
    ).toBe('Sebagian foto belum terunggah. Kami coba lagi otomatis.');
    expect(
      localStatusText(item({ state: 'waiting_network', last_error: { kind: 'auth', code: null, message: null } })),
    ).toMatch(/Sesi masuk/);
    expect(
      localErrorText(item({ state: 'error', last_error: { kind: 'storage', code: '413', message: null } })),
    ).toMatch(/maks 10 MB/);
    expect(
      localErrorText(
        item({ state: 'error', last_error: { kind: 'rpc', code: 'INVALID_INPUT', message: 'Hint server' } }),
      ),
    ).toBe('Hint server');
  });
});

describe('lain-lain', () => {
  it('kelompok galeri "Atur sendiri" mengikuti nomor, urut file', () => {
    expect(groupFiles(['a', 'b', 'c', 'd'], [2, 1, 2, 3])).toEqual([['b'], ['a', 'c'], ['d']]);
  });
  it('ukuran antrean', () => {
    expect(formatBytes(52 * 1024 * 1024)).toBe('52 MB');
    expect(formatBytes(1.4 * 1024 * 1024)).toBe('1,4 MB');
    expect(formatBytes(850 * 1024)).toBe('850 kB');
  });
  it('CSP §11.6: Supabase di connect-src dan img-src, blob:/data:, tanpa eval di produksi', () => {
    const csp = buildCsp('https://abc.supabase.co/');
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co");
    expect(csp).toContain("img-src 'self' blob: data: https://abc.supabase.co");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(buildCsp(undefined, true)).toContain("'unsafe-eval'");
  });
});
