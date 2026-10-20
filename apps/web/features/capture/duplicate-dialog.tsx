'use client';
// Dialog duplikat hash U-10 (D-20 tahap 1): "Foto ini sudah pernah diunggah pada 12 Okt.
// [Lihat yang lama] [Tetap unggah]". Dipakai di S-07 (online) dan S-08 (cek tertunda saat offline).
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DUPLICATE_COPY, fill } from '@/lib/copy/id';
import { findListedCapture } from '@/lib/data/captures';
import { formatTransactionDate, todayInZone } from '@/lib/format';
import type { DuplicateMatch } from '@/lib/offline/outbox-store';

/**
 * Tanggal unggahan lama di zona household: "kemarin", "12 Okt 2026". Q-74/D-86: jika R13 di cache
 * memuat capture lama, nama tokonya ikut disebut ("12 Okt 2026 (struk AEON BSD)"), tanpa RPC baru.
 */
export function duplicateDate(match: DuplicateMatch | undefined, timeZone: string, qc?: QueryClient): string {
  if (!match) return '';
  const date = formatTransactionDate(todayInZone(timeZone, new Date(match.created_at)), timeZone);
  const listed = qc ? findListedCapture(qc, match.capture_id) : undefined;
  const store = [
    listed?.store_name,
    listed?.branch_name && listed.branch_name !== listed.store_name ? listed.branch_name : null,
  ]
    .filter(Boolean)
    .join(' ');
  return listed?.kind === 'receipt' && store ? fill(DUPLICATE_COPY.dateWithStore, { date, store }) : date;
}

export function DuplicateDialog({
  match,
  timeZone,
  onKeep,
  onView,
  onDismiss,
}: {
  match: DuplicateMatch | null;
  timeZone: string;
  onKeep: () => void;
  onView: (captureId: string) => void;
  onDismiss: () => void;
}) {
  const qc = useQueryClient();
  return (
    <Dialog open={Boolean(match)} onOpenChange={(v) => (v ? undefined : onDismiss())}>
      <DialogContent>
        <div className="flex flex-col gap-4">
          <DialogTitle>{DUPLICATE_COPY.title}</DialogTitle>
          <DialogDescription>
            {fill(DUPLICATE_COPY.body, { date: duplicateDate(match ?? undefined, timeZone, qc) })}
          </DialogDescription>
          <div className="flex flex-col gap-2">
            <Button size="action" onClick={onKeep}>
              {DUPLICATE_COPY.keep}
            </Button>
            <Button size="action" variant="secondary" onClick={() => match && onView(match.capture_id)}>
              {DUPLICATE_COPY.view}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
