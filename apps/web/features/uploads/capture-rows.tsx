'use client';
// CaptureRow (docs/07 §7.2): baris S-08 per status dari R13, dan baris antrean lokal (U-17).
import type { CaptureListItem } from '@priceatlas/contracts';
import { ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DUPLICATE_COPY, fill, UPLOADS_COPY } from '@/lib/copy/id';
import { useRetryCapture } from '@/lib/data/captures';
import { errorCopy } from '@/lib/data/errors';
import type { Outbox } from '@/lib/offline/outbox';
import type { OutboxItem } from '@/lib/offline/outbox-store';
import { isHeld } from '@/lib/offline/uploader';
import { duplicateDate } from '@/features/capture/duplicate-dialog';
import { captureStatusText, captureTitle, localErrorText, localStatusText } from './capture-text';

export const detailHref = (id: string) => `/unggahan/detail?id=${id}`;

function KindChip({ kind }: { kind: CaptureListItem['kind'] }) {
  return (
    <span className="rounded border border-border px-1.5 text-xs font-medium uppercase">{UPLOADS_COPY.kind[kind]}</span>
  );
}

export function CaptureRow({ c, timeZone }: { c: CaptureListItem; timeZone: string }) {
  const retry = useRetryCapture();
  const title = captureTitle(c, timeZone);
  const status = captureStatusText(c);
  return (
    <li data-testid="capture-row" data-status={c.status} className="flex items-center gap-2 border-b border-divider">
      <Link
        href={detailHref(c.id)}
        className="flex min-h-action flex-1 items-center gap-2 py-2"
        aria-label={`${UPLOADS_COPY.kindLong[c.kind]}, ${title}: ${status}`}
      >
        <KindChip kind={c.kind} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{title}</span>
          <span className={c.status === 'failed' ? 'text-sm text-danger' : 'text-sm font-medium'}>{status}</span>
        </span>
        {c.status !== 'failed' ? <ChevronRight aria-hidden className="size-5 shrink-0" /> : null}
      </Link>
      {c.status === 'failed' ? (
        <Button
          variant="secondary"
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate(c.id, {
              onSuccess: () => toast.success(UPLOADS_COPY.retried),
              onError: (e) => toast.error(errorCopy(e, 'S-09').message),
            })
          }
        >
          <RefreshCw aria-hidden />
          {UPLOADS_COPY.retry}
        </Button>
      ) : null}
    </li>
  );
}

export function LocalRow({ item, outbox, timeZone }: { item: OutboxItem; outbox: Outbox; timeZone: string }) {
  const [confirm, setConfirm] = useState(false);
  const held = isHeld(item);
  const status = held
    ? fill(DUPLICATE_COPY.inQueue, { date: duplicateDate(item.duplicate.matches[0], timeZone) })
    : localStatusText(item);
  return (
    <li data-testid="local-row" data-state={item.state} className="flex flex-col gap-2 border-b border-divider py-2">
      <div className="flex items-center gap-2">
        <KindChip kind={item.kind} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm">{fill(UPLOADS_COPY.localParts, { n: item.parts.length })}</span>
          <span className={item.state === 'error' ? 'text-sm text-danger' : 'text-sm font-medium'}>{status}</span>
          {item.state === 'error' ? <span className="text-sm">{localErrorText(item)}</span> : null}
        </span>
      </div>
      {item.state !== 'submitted' ? (
        <div className="flex flex-wrap gap-2">
          {held ? (
            <Button variant="secondary" onClick={() => void outbox.keepDuplicate(item.capture_id)}>
              {DUPLICATE_COPY.keep}
            </Button>
          ) : null}
          {item.state === 'error' ? (
            <Button variant="secondary" onClick={() => void outbox.retry(item.capture_id)}>
              <RefreshCw aria-hidden />
              {UPLOADS_COPY.localRetry}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            <Trash2 aria-hidden />
            {UPLOADS_COPY.localRemove}
          </Button>
        </div>
      ) : null}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <div className="flex flex-col gap-4">
            <DialogTitle>{UPLOADS_COPY.localRemoveTitle}</DialogTitle>
            <DialogDescription>{UPLOADS_COPY.localRemoveBody}</DialogDescription>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirm(false)}>
                {UPLOADS_COPY.cancel}
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  setConfirm(false);
                  void outbox.remove(item.capture_id);
                }}
              >
                {UPLOADS_COPY.localRemove}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}
