'use client';
// Dialog duplikat hash U-10 (D-20 tahap 1): "Foto ini sudah pernah diunggah pada 12 Okt.
// [Lihat yang lama] [Tetap unggah]". Dipakai di S-07 (online) dan S-08 (cek tertunda saat offline).
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DUPLICATE_COPY, fill } from '@/lib/copy/id';
import { formatTransactionDate, todayInZone } from '@/lib/format';
import type { DuplicateMatch } from '@/lib/offline/outbox-store';

/** Tanggal unggahan lama di zona household: "kemarin", "12 Okt 2026". */
export function duplicateDate(match: DuplicateMatch | undefined, timeZone: string): string {
  if (!match) return '';
  return formatTransactionDate(todayInZone(timeZone, new Date(match.created_at)), timeZone);
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
  return (
    <Dialog open={Boolean(match)} onOpenChange={(v) => (v ? undefined : onDismiss())}>
      <DialogContent>
        <div className="flex flex-col gap-4">
          <DialogTitle>{DUPLICATE_COPY.title}</DialogTitle>
          <DialogDescription>
            {fill(DUPLICATE_COPY.body, { date: duplicateDate(match ?? undefined, timeZone) })}
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
