'use client';
// S-09 Detail unggahan (docs/07 §7.3, wireframe S-09): R14 (polling 5 dtk saat uploaded/processing),
// ImageCarousel dengan signed URL 300 dtk (tidak di-persist / di-cache SW, P-14), StatusTimeline,
// aksi per status: uploaded → Hapus (W3); processing → bilah tak tentu; needs_confirmation →
// "Cek sekarang" → S-10 (struk) / S-11 (label, screenshot); done → daftar ringkas + "Lihat struk"
// (S-10 mode tersimpan) / "Lihat harga" (S-11);
// failed → Ulangi (W2) / Foto ulang / Hapus. Gambar dihapus retensi (purged_at, D-32).
// Capture teks (D-100): kartu "Teks tempelan" menggantikan foto; "Tempel ulang" → S-21.
import type { CaptureDetail } from '@priceatlas/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Camera, ClipboardPaste, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingState } from '@/components/app/screen-state';
import { BasisLabel, PriceText } from '@/components/price/price';
import { productHref } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ERROR_COPY, fill, PASTE_COPY, UPLOAD_DETAIL_COPY, UPLOADS_COPY } from '@/lib/copy/id';
import { findListedCapture, useCapture, useDeleteCapture, useRetryCapture, useSignedUrl } from '@/lib/data/captures';
import { errorCopy, toAppError } from '@/lib/data/errors';
import { useProductCards } from '@/lib/data/queries';
import { PASTE_HREF, photoCaptureEnabled } from '@/lib/features';
import { formatTime, formatTransactionDate, todayInZone } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { captureErrorAction, captureErrorText } from './capture-text';
import { confirmHref } from './capture-rows';

type Detail = CaptureDetail;

/** Waktu timestamptz di zona household: "kemarin 14:05", "12 Okt 2026 09:10". */
function when(ts: string, tz: string): string {
  return `${formatTransactionDate(todayInZone(tz, new Date(ts)), tz)} ${formatTime(ts, tz)}`;
}

function CarouselImage({ path, purged, n, total }: { path: string; purged: boolean; n: number; total: number }) {
  const url = useSignedUrl(purged ? null : path);
  const label = fill(UPLOAD_DETAIL_COPY.image, { n, total });
  return (
    <li className="w-4/5 shrink-0 snap-center" data-testid="carousel-image">
      {purged ? (
        <p className="flex h-64 items-center rounded-lg bg-muted p-4 text-base">{UPLOAD_DETAIL_COPY.imagePurged}</p>
      ) : url.data ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL Storage, tidak lewat optimizer
        <img src={url.data} alt={label} className="h-64 w-full rounded-lg bg-muted object-contain" />
      ) : url.isError ? (
        <p className="flex h-64 items-center rounded-lg bg-muted p-4 text-sm">{UPLOAD_DETAIL_COPY.imageFailed}</p>
      ) : (
        <Skeleton className="h-64 w-full" aria-label={label} />
      )}
    </li>
  );
}

function ImageCarousel({ images }: { images: Detail['images'] }) {
  const allPurged = images.length > 0 && images.every((i) => i.purged_at);
  return (
    <section aria-labelledby="judul-foto" className="flex flex-col gap-2">
      <h2 id="judul-foto" className="text-lg font-semibold">
        {UPLOAD_DETAIL_COPY.images}
      </h2>
      {allPurged ? (
        <p className="rounded-lg bg-muted p-4 text-base" data-testid="images-purged">
          {UPLOAD_DETAIL_COPY.imagePurged}
        </p>
      ) : (
        <ol className="flex snap-x gap-3 overflow-x-auto pb-1">
          {images.map((img) => (
            <CarouselImage
              key={img.position}
              path={img.storage_path}
              purged={Boolean(img.purged_at)}
              n={img.position}
              total={images.length}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function StatusTimeline({ d, tz }: { d: Detail; tz: string }) {
  const c = d.capture;
  return (
    <section aria-labelledby="judul-status" className="flex flex-col gap-2">
      <h2 id="judul-status" className="text-lg font-semibold">
        {UPLOAD_DETAIL_COPY.timeline}
      </h2>
      <ol className="flex flex-col gap-1 border-l-2 border-divider pl-3 text-sm" data-testid="timeline">
        <li>
          {UPLOAD_DETAIL_COPY.stepUploaded} · {when(c.uploaded_at, tz)}
        </li>
        {d.runs.map((r, i) => (
          <li key={r.id}>
            {fill(UPLOAD_DETAIL_COPY.stepAttempt, { n: i + 1 })} ·{' '}
            {r.status === 'running'
              ? UPLOAD_DETAIL_COPY.runRunning
              : r.status === 'succeeded'
                ? UPLOAD_DETAIL_COPY.runSucceeded
                : `${UPLOAD_DETAIL_COPY.runFailed}${r.error_message ? `: ${r.error_message}` : ''}`}{' '}
            · {when(r.finished_at ?? r.started_at, tz)}
          </li>
        ))}
        {c.processed_at && (c.status === 'done' || c.status === 'needs_confirmation') ? (
          <li>
            {UPLOAD_DETAIL_COPY.stepProcessed} · {when(c.processed_at, tz)}
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function PastedSource({ purged }: { purged: boolean }) {
  return (
    <section aria-labelledby="judul-sumber" className="flex flex-col gap-2" data-testid="pasted-source">
      <h2 id="judul-sumber" className="text-lg font-semibold">
        {PASTE_COPY.sourceTitle}
      </h2>
      <p className="rounded-lg bg-muted p-4 text-base">{purged ? PASTE_COPY.sourcePurged : PASTE_COPY.sourceBody}</p>
    </section>
  );
}

function SavedList({ records, tz }: { records: Detail['saved_records']; tz: string }) {
  const cards = useProductCards([...new Set(records.map((r) => r.product_id))]);
  const byId = new Map((cards.data ?? []).map((c) => [c.product.id, c.product]));
  return (
    <section aria-labelledby="judul-tersimpan" className="flex flex-col gap-2">
      <h2 id="judul-tersimpan" className="text-lg font-semibold">
        {UPLOAD_DETAIL_COPY.savedList}
      </h2>
      <ul className="flex flex-col gap-1">
        {records.map((r) => {
          const p = byId.get(r.product_id);
          const name = p ? productTitle(p) : null;
          return (
            <li key={r.id} data-testid="saved-record">
              <Link
                href={productHref(r.product_id)}
                className="flex min-h-touch flex-col rounded-lg border border-divider px-3 py-2"
              >
                <span className="font-medium">
                  {name ? `${name.title} ${name.size}` : <Skeleton className="inline-block h-4 w-32" />}
                </span>
                <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <PriceText value={r.effective_price} className="font-semibold" />
                  <BasisLabel basis={r.price_basis} />
                  <span className="text-muted-foreground">
                    {r.store_name} · {formatTransactionDate(r.transaction_date, tz)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Foto ulang, atau S-21 untuk capture teks / saat foto mati (D-100). */
const retakeHref = (kind: Detail['capture']['kind'], text: boolean) =>
  text || !photoCaptureEnabled()
    ? PASTE_HREF
    : kind === 'receipt'
      ? '/kamera?jenis=struk'
      : kind === 'marketplace'
        ? '/kamera?jenis=screenshot'
        : '/kamera?jenis=label';

export function UploadDetailScreen() {
  const router = useRouter();
  const id = useSearchParams()?.get('id') ?? null;
  const tz = useTimeZone();
  const qc = useQueryClient();
  const q = useCapture(id);
  const retry = useRetryCapture();
  const del = useDeleteCapture();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const back = (
    <Button variant="secondary" asChild className="self-start">
      <Link href="/unggahan">
        <ArrowLeft aria-hidden />
        {UPLOAD_DETAIL_COPY.back}
      </Link>
    </Button>
  );

  if (!id || (q.isError && !q.data)) {
    const notFound = !id || toAppError(q.error).code === 'NOT_FOUND';
    return (
      <section className="flex flex-col gap-3 p-4">
        <ErrorState
          error={q.error}
          screen="S-09"
          message={notFound ? ERROR_COPY.NOT_FOUND.message : undefined}
          onRetry={notFound ? undefined : () => void q.refetch()}
        />
        {back}
      </section>
    );
  }
  if (!q.data) {
    return (
      <section className="flex flex-col gap-3 p-4">
        <LoadingState>
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-20 w-full" />
        </LoadingState>
      </section>
    );
  }

  const d = q.data;
  const c = d.capture;
  const listed = findListedCapture(qc, c.id);
  const attempts = d.runs.length;

  const doRetry = () =>
    retry.mutate(c.id, {
      onSuccess: () => {
        setActionError(null);
        toast.success(UPLOADS_COPY.retried);
      },
      onError: (e) => {
        setActionError(errorCopy(e, 'S-09').message);
        void q.refetch();
      },
    });
  const doDelete = () =>
    del.mutate(c.id, {
      onSuccess: () => {
        toast.success(UPLOAD_DETAIL_COPY.deleted);
        router.replace('/unggahan');
      },
      onError: (e) => {
        setConfirmDelete(false);
        setActionError(errorCopy(e, 'S-09').message);
        void q.refetch();
      },
    });

  const deleteButton = (
    <Button variant="ghost" size="action" onClick={() => setConfirmDelete(true)} disabled={del.isPending}>
      <Trash2 aria-hidden />
      {UPLOAD_DETAIL_COPY.delete}
    </Button>
  );

  const isText = c.source === 'text';
  let status: ReactNode;
  let actions: ReactNode = null;
  switch (c.status) {
    case 'uploaded':
      status = <p className="text-lg font-semibold">{UPLOAD_DETAIL_COPY.status.uploaded}</p>;
      actions = deleteButton;
      break;
    case 'processing':
      status = (
        <div className="flex flex-col gap-2">
          <p className="text-lg font-semibold">{UPLOAD_DETAIL_COPY.status.processing}</p>
          <div
            role="progressbar"
            aria-label={UPLOAD_DETAIL_COPY.processingLabel}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
          <p className="text-sm text-muted-foreground">{UPLOAD_DETAIL_COPY.leaveOk}</p>
        </div>
      );
      break;
    case 'needs_confirmation':
      status = (
        <p className="text-lg font-semibold">
          {listed && listed.needs_check_count > 0
            ? fill(UPLOAD_DETAIL_COPY.needsCheckCount, { n: listed.needs_check_count })
            : UPLOAD_DETAIL_COPY.needsCheckSome}
        </p>
      );
      actions = (
        <Button size="action" asChild>
          <Link href={confirmHref(c.id, d.receipt_id)}>{UPLOAD_DETAIL_COPY.checkNow}</Link>
        </Button>
      );
      break;
    case 'done':
      status = (
        <p className="text-lg font-semibold">
          {fill(UPLOAD_DETAIL_COPY.status.done, { n: d.saved_records.filter((r) => r.status === 'active').length })}
        </p>
      );
      actions = (
        <Button size="action" variant="secondary" asChild>
          <Link href={confirmHref(c.id, d.receipt_id)}>
            {d.receipt_id ? UPLOAD_DETAIL_COPY.viewReceipt : UPLOAD_DETAIL_COPY.viewItems}
          </Link>
        </Button>
      );
      break;
    case 'failed': {
      const retake = captureErrorAction(c.error_code) === 'retake';
      const pasteRetake = isText || !photoCaptureEnabled();
      status = (
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-danger">{captureErrorText(c.error_code, c.error_message)}</p>
          {attempts ? (
            <p className="text-sm text-muted-foreground">{fill(UPLOAD_DETAIL_COPY.attempt, { n: attempts })}</p>
          ) : null}
        </div>
      );
      const retryBtn = (
        <Button size="action" variant={retake ? 'secondary' : 'primary'} onClick={doRetry} disabled={retry.isPending}>
          <RefreshCw aria-hidden />
          {UPLOAD_DETAIL_COPY.retry}
        </Button>
      );
      const retakeBtn = (
        <Button size="action" variant={retake ? 'primary' : 'secondary'} asChild>
          <Link href={retakeHref(c.kind, isText)}>
            {pasteRetake ? <ClipboardPaste aria-hidden /> : <Camera aria-hidden />}
            {pasteRetake ? PASTE_COPY.retake : UPLOAD_DETAIL_COPY.retake}
          </Link>
        </Button>
      );
      actions = (
        <div className="flex flex-col gap-2">
          {retake ? retakeBtn : retryBtn}
          {retake ? retryBtn : retakeBtn}
          {deleteButton}
        </div>
      );
      break;
    }
  }

  return (
    <section className="flex flex-col gap-5 p-4" aria-labelledby="judul-layar">
      <div className="flex flex-col gap-1">
        <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
          {UPLOADS_COPY.kindLong[c.kind]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[listed?.store_name, listed?.branch_name].filter(Boolean).join(' · ') || UPLOAD_DETAIL_COPY.title}
        </p>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
      <div data-testid="detail-status" data-status={c.status}>
        {status}
      </div>
      {actionError ? (
        <p role="alert" className="rounded-lg border border-danger p-3 text-sm">
          {actionError}
        </p>
      ) : null}
      {isText ? <PastedSource purged={!c.pasted_text} /> : <ImageCarousel images={d.images} />}
      {c.status === 'done' && d.saved_records.length ? <SavedList records={d.saved_records} tz={tz} /> : null}
      <StatusTimeline d={d} tz={tz} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{UPLOAD_DETAIL_COPY.uploadedAt}</dt>
        <dd>{when(c.uploaded_at, tz)}</dd>
        {c.captured_at ? (
          <>
            <dt className="text-muted-foreground">{UPLOAD_DETAIL_COPY.capturedAt}</dt>
            <dd>{when(c.captured_at, tz)}</dd>
          </>
        ) : null}
      </dl>
      {actions ? <div className="flex flex-col gap-2">{actions}</div> : null}
      {back}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <div className="flex flex-col gap-4">
            <DialogTitle>{UPLOAD_DETAIL_COPY.deleteTitle}</DialogTitle>
            <DialogDescription>{UPLOAD_DETAIL_COPY.deleteBody}</DialogDescription>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
                {UPLOADS_COPY.cancel}
              </Button>
              <Button variant="danger" className="flex-1" onClick={doDelete} disabled={del.isPending}>
                {UPLOAD_DETAIL_COPY.delete}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
