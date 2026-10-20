// Teks baris unggahan (S-08, S-09, U-11) dari R13/R14 dan antrean lokal. Murni, diuji unit.
import type { CaptureListItem } from '@priceatlas/contracts';
import { CAPTURE_ERROR_COPY, ERROR_COPY, fill, GENERIC_COPY, UPLOADS_COPY } from '@/lib/copy/id';
import { formatRelativeTime, formatTransactionDate } from '@/lib/format';
import type { OutboxItem } from '@/lib/offline/outbox-store';

/** §8.3: alasan gagal proses. `other`/null → error_message server, atau "Gambar tidak terbaca." */
export function captureErrorText(code: string | null | undefined, message: string | null | undefined): string {
  if (code && code !== 'other' && code in CAPTURE_ERROR_COPY)
    return CAPTURE_ERROR_COPY[code as keyof typeof CAPTURE_ERROR_COPY].message;
  return message?.trim() || CAPTURE_ERROR_COPY.other.message;
}

/** Aksi utama §8.3 untuk capture gagal: "Foto ulang" (buram, bukan struk, format) atau "Ulangi". */
export function captureErrorAction(code: string | null | undefined): 'retake' | 'retry' {
  return code === 'blurry' || code === 'not_a_receipt' || code === 'unsupported' ? 'retake' : 'retry';
}

/** "AEON · AEON BSD · 12 Okt 2026" atau "diunggah 2 menit lalu" (wireframe S-08 tabel data). */
export function captureTitle(c: CaptureListItem, timeZone: string, now = new Date()): string {
  const place = [c.store_name, c.branch_name].filter(Boolean).join(' · ');
  if (c.date_is_upload) {
    const up = fill(UPLOADS_COPY.uploadedAgo, { ago: formatRelativeTime(c.uploaded_at, now) });
    return place ? `${place} · ${up}` : up;
  }
  const date = formatTransactionDate(c.date, timeZone, now);
  return place ? `${place} · ${date}` : date;
}

/** Teks status kanan baris (wireframe S-08). */
export function captureStatusText(c: CaptureListItem): string {
  switch (c.status) {
    case 'needs_confirmation':
      return c.needs_check_count > 0
        ? fill(UPLOADS_COPY.needsCheckCount, { n: c.needs_check_count })
        : UPLOADS_COPY.needsCheckSome;
    case 'uploaded':
      return UPLOADS_COPY.queued;
    case 'processing':
      return UPLOADS_COPY.processing;
    case 'done':
      return c.saved_count > 0 ? fill(UPLOADS_COPY.saved, { n: c.saved_count }) : UPLOADS_COPY.savedNone;
    case 'failed':
      return captureErrorText(c.error_code, c.error_message);
  }
}

/** "Struk AEON BSD" — subjek pengumuman status (U-11). */
export function captureSubject(c: Pick<CaptureListItem, 'kind' | 'store_name' | 'branch_name'>): string {
  const place = c.branch_name ?? c.store_name;
  return place ? `${UPLOADS_COPY.kindLong[c.kind]} ${place}` : UPLOADS_COPY.kindLong[c.kind];
}

/** Pengumuman perubahan status penting (selesai, perlu dicek, gagal); null jika tidak penting. */
export function statusAnnouncement(prev: CaptureListItem['status'] | undefined, c: CaptureListItem): string | null {
  if (!prev || prev === c.status) return null;
  const what = captureSubject(c);
  if (c.status === 'needs_confirmation') return fill(UPLOADS_COPY.announceNeeds, { what });
  if (c.status === 'done') return fill(UPLOADS_COPY.announceDone, { what, n: c.saved_count });
  if (c.status === 'failed')
    return fill(UPLOADS_COPY.announceFailed, { what, reason: captureErrorText(c.error_code, c.error_message) });
  return null;
}

/** Teks status item antrean lokal (U-17, §5.4). */
export function localStatusText(i: OutboxItem): string {
  const l = UPLOADS_COPY.local;
  if (i.state === 'uploading')
    return fill(l.uploading, { i: Math.min(i.uploaded.length + 1, i.parts.length), n: i.parts.length });
  if (i.state === 'waiting_network') {
    if (i.last_error?.kind === 'missing') return ERROR_COPY.CAPTURE_IMAGES_MISSING.message;
    if (i.last_error?.kind === 'auth') return UPLOADS_COPY.localAuth;
    return l.waiting_network;
  }
  return l[i.state];
}

/** Penjelasan item error permanen: 413/415 = ditolak bucket (§8.2), selain itu hint server/umum. */
export function localErrorText(i: OutboxItem): string {
  const e = i.last_error;
  if (!e) return GENERIC_COPY.unknown.message;
  if (e.kind === 'storage' && (e.code === '413' || e.code === '415' || e.code === '400'))
    return GENERIC_COPY.storageRejected.message;
  return e.message && e.kind === 'rpc' ? e.message : GENERIC_COPY.unknown.message;
}
