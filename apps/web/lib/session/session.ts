// Sesi belanja (D-11, D-43, D-60, D-72; wireframe S-13, §5.6; docs/07 §7.3 S-13): logika murni
// tanpa React supaya diuji unit (L5a). Waktu selalu dari jam perangkat (ms epoch) terhadap
// timestamptz server; jam ditampilkan di zona household lewat lib/format.
import type { ActiveSession, SessionLabel } from '@priceatlas/contracts';
import type { OutboxItem } from '@/lib/offline/outbox-store';

/** "Hampir kedaluwarsa" (wireframe S-13): kurang dari 30 menit. */
export const NEAR_EXPIRY_MS = 30 * 60_000;
/** Polling R18 sama dengan R13 (docs/07 §5.5). */
export const SESSION_POLL_MS = 5_000;

export interface SessionClock {
  elapsedMs: number;
  remainingMs: number;
  /** D-43: `expires_at <= now` (R18 tidak lagi mengembalikan sesi ini). */
  expired: boolean;
  /** Sisa < 30 menit dan belum kedaluwarsa → "Perpanjang" (W12, W-20). */
  nearExpiry: boolean;
}

export function sessionClock(s: { started_at: string; expires_at: string }, now: number): SessionClock {
  const remainingMs = Date.parse(s.expires_at) - now;
  const expired = remainingMs <= 0;
  return {
    elapsedMs: Math.max(0, now - Date.parse(s.started_at)),
    remainingMs: Math.max(0, remainingMs),
    expired,
    nearExpiry: !expired && remainingMs < NEAR_EXPIRY_MS,
  };
}

/** Sisa menit untuk "Sesi berakhir 25 menit lagi" (dibulatkan ke atas, minimal 1). */
export function remainingMinutes(remainingMs: number): number {
  return Math.max(1, Math.ceil(remainingMs / 60_000));
}

/** Sesi dari R18 yang masih aktif menurut jam sekarang; data cache yang sudah lewat → null. */
export function activeOrNull(data: ActiveSession | null | undefined, now: number): ActiveSession | null {
  return data && !sessionClock(data.session, now).expired ? data : null;
}

/**
 * Nama tempat untuk banner/judul: "AEON BSD" (nama cabang sudah memuat toko), selain itu
 * "Alfamart · Serpong".
 */
export function sessionPlace(s: Pick<ActiveSession, 'store' | 'branch'>): string {
  const store = s.store.name.trim();
  const branch = s.branch.name.trim();
  return branch.toLowerCase().includes(store.toLowerCase()) ? branch : `${store} · ${branch}`;
}

// ---------------------------------------------------------------------------
// Label sesi (R18 labels + antrean lokal)
// ---------------------------------------------------------------------------
export interface SessionCapture {
  capture_id: string;
  status: SessionLabel['status'];
  /** Item yang tidak ditolak; kosong untuk uploaded/processing/failed. */
  items: SessionLabel[];
  /** storage_path gambar posisi 1 (6b M4, Q-97); null jika sudah di-purge atau R18 lama. */
  thumbnail_path: string | null;
}

/**
 * Status per item (6b M4, Q-81). R18 lama (cache di perangkat sebelum M4) tidak membawa
 * `item_status`: item foto `needs_confirmation` dianggap perlu dicek (perilaku per foto, F-61).
 */
export function itemNeedsCheck(c: Pick<SessionCapture, 'status'>, l: SessionLabel): boolean {
  if (l.item_status === 'pending') return true;
  if (l.item_status === 'accepted') return false;
  return c.status === 'needs_confirmation';
}

/**
 * R18 memberi satu baris per item (urut unggah terbaru dulu). Satu foto label = satu capture
 * (wireframe S-07), jadi baris dikelompokkan per capture dengan urutan yang sama.
 */
export function groupSessionLabels(labels: readonly SessionLabel[]): SessionCapture[] {
  const out: SessionCapture[] = [];
  const byId = new Map<string, SessionCapture>();
  for (const l of labels) {
    let g = byId.get(l.capture_id);
    if (!g) {
      g = { capture_id: l.capture_id, status: l.status, items: [], thumbnail_path: l.thumbnail_path ?? null };
      byId.set(l.capture_id, g);
      out.push(g);
    }
    if (l.item_id) g.items.push(l);
  }
  return out;
}

/** Foto sesi yang masih di antrean HP (belum ada di R18): "menunggu sinyal" (docs/07 §5.4). */
export function localSessionItems(
  items: readonly OutboxItem[],
  sessionId: string,
  labels: readonly SessionLabel[],
): OutboxItem[] {
  const known = new Set(labels.map((l) => l.capture_id));
  return items.filter((i) => i.shopping_session_id === sessionId && !known.has(i.capture_id));
}

/** "4 label" di banner/S-13: foto (capture) di sesi ini, termasuk yang masih di HP. */
export function sessionLabelCount(labels: readonly SessionLabel[], local: readonly OutboxItem[]): number {
  return new Set(labels.map((l) => l.capture_id)).size + local.length;
}

/** P-15 + docs/07 §5.5: polling R18 hanya jika ada label uploaded/processing dan tab terlihat. */
export function sessionPollInterval(
  data: ActiveSession | null | undefined,
  visible = typeof document === 'undefined' || document.visibilityState === 'visible',
): number | false {
  const busy = data?.labels.some((l) => l.status === 'uploaded' || l.status === 'processing') ?? false;
  return busy && visible ? SESSION_POLL_MS : false;
}

// ---------------------------------------------------------------------------
// vs_best_pct (wireframe S-13, W-08)
// ---------------------------------------------------------------------------
export type LabelComparison =
  | { kind: 'cheaper'; pct: number }
  | { kind: 'same' }
  | { kind: 'near'; pct: number }
  | { kind: 'pricier'; pct: number };

/**
 * Teks pembanding label terhadap termurah 90 hari (R18 `vs_best_pct`, persen dengan 1 desimal).
 * Dibulatkan ke persen bulat seperti formatPercent: < 0 → lebih murah, 0 → setara, ≤ ambang
 * `near_best_threshold_pct` (R2, W-08) → mendekati, selain itu lebih mahal. null → tanpa teks
 * (belum ada data 90 hari).
 */
export function labelComparison(pct: number | null | undefined, nearPct: number): LabelComparison | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const r = Math.round(pct);
  if (r < 0) return { kind: 'cheaper', pct: -r };
  if (r === 0) return { kind: 'same' };
  return r <= nearPct ? { kind: 'near', pct: r } : { kind: 'pricier', pct: r };
}

// ---------------------------------------------------------------------------
// Sesi yang berakhir otomatis (D-43): R18 hanya memberi sesi aktif, jadi sesi terakhir diingat di
// perangkat (prefs) untuk teks "Sesi di AEON BSD berakhir otomatis pukul 18:05. 4 label tersimpan."
// ---------------------------------------------------------------------------
export interface RememberedSession {
  id: string;
  place: string;
  expires_at: string;
  label_count: number;
}

export function rememberSession(s: ActiveSession, localCount = 0): RememberedSession {
  return {
    id: s.session.id,
    place: sessionPlace(s),
    expires_at: s.session.expires_at,
    label_count: sessionLabelCount(s.labels, []) + localCount,
  };
}

/**
 * Pemberitahuan "berakhir otomatis" jika sesi yang diingat sudah lewat `expires_at` dan tidak ada
 * sesi aktif lain. Sesi yang hilang dari R18 sebelum waktunya diakhiri di tempat lain (W13) →
 * tanpa pemberitahuan.
 */
export function expiredNotice(
  remembered: RememberedSession | null,
  active: ActiveSession | null,
  now: number,
): RememberedSession | null {
  if (!remembered) return null;
  if (active && active.session.id !== remembered.id) return null;
  if (active && !sessionClock(active.session, now).expired) return null;
  return Date.parse(remembered.expires_at) <= now ? remembered : null;
}

/** Urutan pilihan di sheet S-06 (U-08): sesi aktif → Label di atas. */
export type PhotoOption = 'receipt' | 'label' | 'screenshot';
export function photoOptionOrder(hasSession: boolean): PhotoOption[] {
  return hasSession ? ['label', 'receipt', 'screenshot'] : ['receipt', 'label', 'screenshot'];
}

/** Status foto sesi yang masih di HP (S-13 "menunggu sinyal", docs/07 §5.4). */
export type LocalLabelState = 'waiting' | 'uploading' | 'held' | 'error';
export function localLabelState(i: OutboxItem, online: boolean): LocalLabelState {
  if (i.duplicate.status === 'found') return 'held';
  if (i.state === 'error') return 'error';
  if (i.state === 'uploading' || i.state === 'submitting' || i.state === 'submitted') return 'uploading';
  return online && i.state === 'captured' ? 'uploading' : 'waiting';
}
