// @vitest-environment jsdom
// L5a M4 (docs/07 §11.1): waktu sesi (sisa, < 30 mnt, kedaluwarsa, durasi "1j 12m", jam di zona
// household), teks vs_best_pct, urutan U-08, aturan polling R18 (P-15), pemetaan error §8.2 S-12
// mode sesi / S-13, label sesi (kelompok per foto, antrean lokal, jumlah), sesi yang diingat (D-43),
// lokasi label manual (F-53), dan frame kamera → pipeline gambar (logika; canvas tiruan).
// Fixture = keluaran RPC asli (test/fixtures/rpc.json).
import type { ActiveSession, SessionLabel } from '@priceatlas/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { comparisonText } from '@/features/shopping/session-labels';
import { AppError } from '@/lib/data/errors';
import { formatDuration, formatTime } from '@/lib/format';
import { FrameNotReadyError, frameSize, prepareLabelFrame } from '@/lib/media/frame';
import { sha256Hex } from '@/lib/media/sha256';
import { newItem, type OutboxItem } from '@/lib/offline/outbox-store';
import { sessionError } from '@/lib/session/errors';
import { labelCameraHref, manualLocationFrom, manualLocationOf } from '@/lib/session/label-target';
import {
  activeOrNull,
  expiredNotice,
  groupSessionLabels,
  labelComparison,
  localLabelState,
  localSessionItems,
  NEAR_EXPIRY_MS,
  photoOptionOrder,
  remainingMinutes,
  rememberSession,
  sessionClock,
  sessionLabelCount,
  sessionPlace,
  sessionPollInterval,
  SESSION_POLL_MS,
} from '@/lib/session/session';
import { fx, installDomPolyfills } from '../m1/harness';

installDomPolyfills();

const MIN = 60_000;
const session = (key = 'session_start') => fx<ActiveSession>(key);
const at = (iso: string, deltaMs = 0) => Date.parse(iso) + deltaMs;
const rpcErr = (key: string) => {
  const e = fx<{ error: { message: string; code: string; details: string; hint: string } }>(key).error;
  return new AppError(
    'rpc',
    {
      code: e.message as never,
      sqlstate: e.code,
      http: Number(e.code.slice(2)),
      detail: JSON.parse(e.details) as Record<string, unknown>,
      hint: e.hint,
      message: e.message,
    },
    e.message,
  );
};

describe('waktu sesi (D-43, W-20)', () => {
  const s = session().session;

  it('durasi berjalan, sisa waktu, belum hampir kedaluwarsa', () => {
    const c = sessionClock(s, at(s.started_at, 72 * MIN));
    expect(formatDuration(c.elapsedMs)).toBe('1j 12m');
    expect(c.remainingMs).toBe(4 * 60 * MIN - 72 * MIN);
    expect(c).toMatchObject({ expired: false, nearExpiry: false });
  });

  it('< 30 menit → hampir kedaluwarsa; "25 menit lagi" dibulatkan ke atas', () => {
    const c = sessionClock(s, at(s.expires_at, -(24 * MIN + 10_000)));
    expect(c.nearExpiry).toBe(true);
    expect(remainingMinutes(c.remainingMs)).toBe(25);
    expect(sessionClock(s, at(s.expires_at, -NEAR_EXPIRY_MS)).nearExpiry).toBe(false);
    expect(remainingMinutes(1000)).toBe(1);
  });

  it('tepat di expires_at → kedaluwarsa (R18 tidak lagi mengembalikan sesi)', () => {
    const c = sessionClock(s, at(s.expires_at));
    expect(c).toMatchObject({ expired: true, nearExpiry: false, remainingMs: 0 });
    expect(activeOrNull(session(), at(s.expires_at))).toBeNull();
    expect(activeOrNull(session(), at(s.expires_at, -1))).not.toBeNull();
    expect(activeOrNull(null, 0)).toBeNull();
  });

  it('jam mulai/berakhir di zona household (R1), bukan zona perangkat', () => {
    // started_at 15:01 WIB (+07:00) = 08:01 UTC.
    expect(formatTime(s.started_at, 'Asia/Jakarta')).toMatch(/^\d{2}:\d{2}$/);
    const t = new Date('2026-10-23T08:01:00Z').toISOString();
    expect(formatTime(t, 'Asia/Jakarta')).toBe('15:01');
    expect(formatTime(t, 'Asia/Makassar')).toBe('16:01');
    expect(formatTime(t, 'UTC')).toBe('08:01');
  });

  it('nama tempat: cabang yang sudah memuat nama toko ditulis sekali', () => {
    expect(sessionPlace(session())).toBe('AEON BSD');
    const other = { store: { ...session().store, name: 'Alfamart' }, branch: { ...session().branch, name: 'Serpong' } };
    expect(sessionPlace(other)).toBe('Alfamart · Serpong');
  });
});

describe('vs_best_pct (wireframe S-13, W-08 ≤ 5 %)', () => {
  it('pembanding dibulatkan seperti formatPercent', () => {
    expect(labelComparison(-12.4, 5)).toEqual({ kind: 'cheaper', pct: 12 });
    expect(labelComparison(-0.4, 5)).toEqual({ kind: 'same' });
    expect(labelComparison(0, 5)).toEqual({ kind: 'same' });
    expect(labelComparison(4.6, 5)).toEqual({ kind: 'near', pct: 5 });
    expect(labelComparison(5.6, 5)).toEqual({ kind: 'pricier', pct: 6 });
    expect(labelComparison(null, 5)).toBeNull();
  });

  it('teks', () => {
    expect(comparisonText(-12, 5)).toBe('12% lebih murah dari biasanya');
    expect(comparisonText(0, 5)).toBe('setara harga terbaikmu');
    expect(comparisonText(3, 5)).toBe('mendekati harga terbaikmu');
    expect(comparisonText(18.2, 5)).toBe('18% lebih mahal dari termurahmu 90 hari');
    expect(comparisonText(null, 5)).toBeNull();
  });

  it('keluaran R18 asli: −2,8 % (lebih murah) sebelum DAN sesudah antrean ringkasan (F-60 → Q-80/Q-81, 6b M4)', () => {
    const before = fx<ActiveSession>('session_labels').labels.find((l) => l.status === 'done' && l.vs_best_pct != null);
    const after = fx<ActiveSession>('session_labels_refreshed').labels.find((l) => l.item_id === before?.item_id);
    expect(comparisonText(before!.vs_best_pct, 5)).toBe('3% lebih murah dari biasanya');
    // Pembanding R18 = termurah 90 hari tanpa record dari sesi ini, jadi tidak menjadi 0 setelah ringkasan.
    expect(after!.vs_best_pct).toBe(before!.vs_best_pct);
    expect(comparisonText(after!.vs_best_pct, 5)).toBe('3% lebih murah dari biasanya');
  });
});

describe('S-06 urutan U-08', () => {
  it('sesi aktif → Label di atas; tanpa sesi → Struk, Label, Screenshot', () => {
    expect(photoOptionOrder(true)).toEqual(['label', 'receipt', 'screenshot']);
    expect(photoOptionOrder(false)).toEqual(['receipt', 'label', 'screenshot']);
  });
});

describe('polling R18 (P-15, docs/07 §5.5)', () => {
  it('hanya jika ada label uploaded/processing dan tab terlihat', () => {
    expect(sessionPollInterval(fx<ActiveSession>('session_uploaded'), true)).toBe(SESSION_POLL_MS);
    expect(sessionPollInterval(fx<ActiveSession>('session_labels'), true)).toBe(SESSION_POLL_MS);
    expect(sessionPollInterval(fx<ActiveSession>('session_labels'), false)).toBe(false);
    expect(sessionPollInterval(session(), true)).toBe(false);
    expect(sessionPollInterval(null, true)).toBe(false);
    const settled = fx<ActiveSession>('session_labels');
    settled.labels = settled.labels.filter((l) => l.status !== 'processing');
    expect(sessionPollInterval(settled, true)).toBe(false);
  });
});

describe('pemetaan error §8.2 (S-12 mode sesi, S-13)', () => {
  it('BRANCH_CLOSED (W11 asli) → pesan + pilih cabang lain', () => {
    expect(sessionError(rpcErr('session_start_closed'), 'S-12')).toEqual({
      message: 'Cabang ini sudah tutup. Pilih cabang lain atau tambah cabang baru.',
      action: { kind: 'pick-other' },
    });
  });

  it('SESSION_NOT_ACTIVE (W12 sesi berakhir/kedaluwarsa, asli) → "Mulai sesi baru"', () => {
    for (const k of ['session_extend_ended', 'session_extend_expired'])
      expect(sessionError(rpcErr(k), 'S-13')).toEqual({
        message: 'Sesi belanja ini sudah berakhir. Mulai sesi baru untuk lanjut.',
        action: { kind: 'start-new' },
      });
  });

  it('jaringan → mulai/ubah sesi butuh sinyal (D-81/Q-54); NOT_FOUND per layar; lain → umum', () => {
    expect(sessionError(new TypeError('Failed to fetch'), 'S-12').message).toMatch(/butuh sinyal/);
    const nf = new AppError(
      'rpc',
      { code: 'NOT_FOUND', sqlstate: 'PT404', http: 404, detail: {}, hint: null, message: 'NOT_FOUND' },
      'NOT_FOUND',
    );
    expect(sessionError(nf, 'S-13').action).toEqual({ kind: 'start-new' });
    expect(sessionError(nf, 'S-12')).toEqual({
      message: 'Data ini tidak ditemukan. Mungkin sudah dihapus.',
      action: { kind: 'reload' },
    });
    expect(sessionError(new Error('x'), 'S-13').action).toEqual({ kind: 'none' });
  });
});

describe('label sesi (R18 + antrean lokal)', () => {
  const labels = fx<ActiveSession>('session_labels').labels;
  const item = (id: string, sessionId: string | null, patch: Partial<OutboxItem> = {}): OutboxItem => ({
    ...newItem({
      capture_id: id,
      kind: 'price_label',
      household_id: null,
      shopping_session_id: sessionId,
      store_id: null,
      branch_id: null,
      captured_at: null,
      parts: [{ position: 1, ext: 'jpg', content_type: 'image/jpeg', sha256: 'a'.repeat(64), byte_size: 10 }],
    }),
    ...patch,
  });

  it('dikelompokkan per foto (capture) dengan urutan R18; item hanya untuk capture ber-item', () => {
    const g = groupSessionLabels(labels);
    expect(g.map((c) => c.status)).toEqual(['processing', 'failed', 'done', 'needs_confirmation']);
    expect(g.map((c) => c.items.length)).toEqual([0, 0, 2, 2]);
    expect(groupSessionLabels([] as SessionLabel[])).toEqual([]);
  });

  it('foto yang masih di HP untuk sesi ini (belum di R18) ikut dihitung: "4 label"', () => {
    const sid = fx<ActiveSession>('session_labels').session.id;
    const queued = [
      item('c1000000-0000-0000-0000-000000000001', sid),
      item('c1000000-0000-0000-0000-000000000002', null),
      item(labels[0]!.capture_id, sid, { state: 'submitted' }),
    ];
    const local = localSessionItems(queued, sid, labels);
    expect(local.map((i) => i.capture_id)).toEqual(['c1000000-0000-0000-0000-000000000001']);
    expect(sessionLabelCount(labels, local)).toBe(5);
    expect(sessionLabelCount([], [])).toBe(0);
  });

  it('status lokal: menunggu sinyal / mengunggah / ditahan duplikat / gagal', () => {
    const sid = 'c0000000-0000-0000-0000-0000000000a1';
    expect(localLabelState(item('x', sid), false)).toBe('waiting');
    expect(localLabelState(item('x', sid, { state: 'waiting_network' }), true)).toBe('waiting');
    expect(localLabelState(item('x', sid), true)).toBe('uploading');
    expect(localLabelState(item('x', sid, { state: 'uploading' }), false)).toBe('uploading');
    expect(localLabelState(item('x', sid, { duplicate: { status: 'found', matches: [] } }), true)).toBe('held');
    expect(localLabelState(item('x', sid, { state: 'error' }), true)).toBe('error');
  });
});

describe('sesi yang berakhir otomatis (D-43): diingat di perangkat', () => {
  const s = fx<ActiveSession>('session_labels');
  const r = rememberSession(s, 1);

  it('isi yang diingat: tempat, expires_at, jumlah label (foto R18 + di HP)', () => {
    expect(r).toEqual({ id: s.session.id, place: 'AEON BSD', expires_at: s.session.expires_at, label_count: 5 });
  });

  it('pemberitahuan hanya setelah expires_at, tanpa sesi aktif lain', () => {
    const exp = Date.parse(r.expires_at);
    expect(expiredNotice(r, null, exp)).toEqual(r);
    // R18 masih di cache tetapi sudah lewat waktunya.
    expect(expiredNotice(r, s, exp + 1)).toEqual(r);
    // Belum lewat: sesi diakhiri di tempat lain (W13) → tanpa pemberitahuan.
    expect(expiredNotice(r, null, exp - 1)).toBeNull();
    // Masih aktif / sesi lain aktif.
    expect(expiredNotice(r, s, exp - 1)).toBeNull();
    expect(expiredNotice(r, fx<ActiveSession>('session_start_expired'), exp + 1)).toBeNull();
    expect(expiredNotice(null, null, exp)).toBeNull();
  });
});

describe('lokasi label tanpa sesi (F-53, D-28)', () => {
  const store = '20000000-0000-0000-0000-000000000001';
  const branch = '30000000-0000-0000-0000-000000000001';

  it('kamera label membawa lokasi manual di URL; "Tidak tahu cabangnya" = tanpa cabang', () => {
    expect(labelCameraHref()).toBe('/kamera?jenis=label');
    expect(labelCameraHref({ storeId: store, branchId: branch })).toBe(
      `/kamera?jenis=label&toko=${store}&cabang=${branch}`,
    );
    expect(labelCameraHref({ storeId: store, branchId: null })).toBe(`/kamera?jenis=label&toko=${store}`);
    expect(
      manualLocationOf({ store: { id: store, name: 'AEON', channel: 'offline', is_private: false }, branch: null }),
    ).toEqual({ storeId: store, branchId: null });
  });

  it('id tidak valid di URL diabaikan (tidak dikirim ke W1)', () => {
    const p = (q: string) => new URLSearchParams(q);
    expect(manualLocationFrom(p(`toko=${store}&cabang=${branch}`))).toEqual({ storeId: store, branchId: branch });
    expect(manualLocationFrom(p(`toko=${store}&cabang=x`))).toEqual({ storeId: store, branchId: null });
    expect(manualLocationFrom(p('toko=aeon'))).toBeNull();
    expect(manualLocationFrom(p(''))).toBeNull();
  });
});

describe('frame kamera → pipeline gambar (logika, canvas tiruan)', () => {
  afterEach(() => vi.restoreAllMocks());
  const LABEL = new Uint8Array(
    readFileSync(resolve(import.meta.dirname, '../../../worker/test/fixtures/label-milo.jpg')),
  );

  it('ukuran canvas: sisi panjang ≤ 2048 px (label), tidak diperbesar', () => {
    expect(frameSize(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(frameSize(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(frameSize(3024, 4032)).toEqual({ width: 1536, height: 2048 });
    expect(() => frameSize(0, 0)).toThrow(FrameNotReadyError);
  });

  it('frame → canvas JPEG 0,85 → prepareImage (kamera: captured_at = saat foto) → sha256 byte final', async () => {
    const drawn: unknown[] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (...a: unknown[]) => drawn.push(a) }),
      toBlob: (cb: (b: Blob) => void, type: string, quality: number) => {
        drawn.push({ type, quality });
        cb(new Blob([LABEL], { type }));
      },
    };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : realCreate(tag)) as typeof document.createElement);
    const video = { readyState: 4, videoWidth: 3840, videoHeight: 2160 } as HTMLVideoElement;
    const now = new Date('2026-10-23T08:05:00Z');
    const p = await prepareLabelFrame(video, now);
    expect([canvas.width, canvas.height]).toEqual([2048, 1152]);
    expect(drawn).toEqual([[video, 0, 0, 2048, 1152], { type: 'image/jpeg', quality: 0.85 }]);
    expect(p.sha256).toBe(await sha256Hex(LABEL));
    expect(p.byteSize).toBe(LABEL.byteLength);
    expect(p.capturedAt).toMatch(/^2026-10-23T\d{2}:05:00[+-]\d{2}:\d{2}$/);
    expect(Date.parse(p.capturedAt!)).toBe(now.getTime());
  });

  it('video tanpa frame (kamera baru menyala) → FrameNotReadyError', async () => {
    const video = { readyState: 1, videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    await expect(prepareLabelFrame(video)).rejects.toBeInstanceOf(FrameNotReadyError);
  });
});
