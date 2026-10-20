'use client';
// S-07 Kamera struk (D-82, Q-51: kamera bawaan lewat <input capture>) dan screenshot dari galeri,
// dengan S-07b (U-09). Struk panjang: "Tambah bagian", urutan bisa diubah, maks 10 bagian (D-81).
// Semua kontrol di sepertiga bawah (U-07). Setiap foto langsung disiapkan (§6.2: EXIF → aturan
// lewati → kompresi di worker → sha256) dan disimpan ke antrean IndexedDB saat "Selesai" (§5.4)
// sebelum apa pun dikirim. Selesai → kembali + toast (U-11), tanpa layar tunggu.
import { ArrowLeft, ChevronLeft, ChevronRight, Images, Plus, ReceiptText, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CAMERA_COPY, fill } from '@/lib/copy/id';
import { useMyContext } from '@/lib/auth/context';
import { formatBytes } from '@/lib/format';
import { lastAppPath } from '@/lib/hooks/last-app-path';
import { flashToast } from '@/lib/flash';
import { useOnline } from '@/lib/hooks/use-online';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { newCaptureId } from '@/lib/media/capture-id';
import { takePendingFiles } from '@/lib/media/handoff';
import type { CaptureKind } from '@/lib/media/image-plan';
import type { ImageSource, PreparedImage } from '@/lib/media/prepare';
import { useOutboxHandle } from '@/lib/offline/outbox-context';
import { newItem, QUEUE_WARN_BYTES, type DuplicateMatch, type OutboxItem } from '@/lib/offline/outbox-store';
import { cn } from '@/lib/utils';
import { DuplicateDialog } from './duplicate-dialog';
import { GalleryDialog } from './gallery-dialog';

/** Batas UI bagian per struk (D-81, Q-64). */
export const MAX_PARTS = 10;

interface Part {
  key: string;
  file: File;
  url: string;
  prepared: Promise<PreparedImage>;
  status: 'preparing' | 'ready' | 'rejected';
}

/** Pipeline dimuat saat dibutuhkan (dynamic import), tidak masuk bundle halaman lain. */
async function prepare(file: File, kind: CaptureKind, source: ImageSource): Promise<PreparedImage> {
  const { prepareImage } = await import('@/lib/media/prepare');
  return prepareImage(file, { kind, source });
}

async function rejectedMessage(e: unknown): Promise<string> {
  const { ImageRejectedError } = await import('@/lib/media/prepare');
  return e instanceof ImageRejectedError && e.reason === 'heic_too_big' ? CAMERA_COPY.heicTooBig : CAMERA_COPY.rejected;
}

let seq = 0;

function FileButton({
  children,
  capture,
  multiple,
  disabled,
  onFiles,
  className,
  testId,
}: {
  children: ReactNode;
  capture?: boolean;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  testId: string;
}) {
  const id = useId();
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) onFiles(files);
  };
  return (
    <label
      htmlFor={id}
      aria-disabled={disabled || undefined}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-1 text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-focus',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {children}
      <input
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={disabled}
        data-testid={testId}
        {...(capture ? { capture: 'environment' as const } : {})}
        multiple={multiple}
        onChange={onChange}
      />
    </label>
  );
}

export function CaptureScreen({ kind }: { kind: 'receipt' | 'marketplace' }) {
  const router = useRouter();
  const outbox = useOutboxHandle();
  const ctx = useMyContext();
  const tz = useTimeZone();
  const online = useOnline();
  const [parts, setParts] = useState<Part[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<{ item: OutboxItem; match: DuplicateMatch } | null>(null);
  const receipt = kind === 'receipt';
  const title = receipt ? CAMERA_COPY.titleReceipt : CAMERA_COPY.titleScreenshot;

  const makePart = (file: File, source: ImageSource): Part => {
    const prepared = prepare(file, kind, source);
    const part: Part = {
      key: `p${++seq}`,
      file,
      url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
      prepared,
      status: 'preparing',
    };
    prepared.then(
      () => setParts((ps) => ps.map((p) => (p.key === part.key ? { ...p, status: 'ready' } : p))),
      async (e) => {
        setError(await rejectedMessage(e));
        setParts((ps) => ps.filter((p) => p.key !== part.key));
      },
    );
    return part;
  };

  const partsRef = useRef<Part[]>([]);
  useEffect(() => {
    partsRef.current = parts;
  }, [parts]);

  const addFiles = (files: File[], source: ImageSource) => {
    setError(null);
    const room = MAX_PARTS - partsRef.current.length;
    if (files.length > room) setError(CAMERA_COPY.maxParts);
    const added = files.slice(0, Math.max(0, room)).map((f) => makePart(f, source));
    partsRef.current = [...partsRef.current, ...added];
    setParts((ps) => [...ps, ...added]);
  };

  const onGallery = (files: File[]) => {
    if (files.length > 1) setGalleryFiles(files);
    else addFiles(files, 'gallery');
  };

  // File dari sheet S-06 (satu ketukan ke kamera bawaan/galeri).
  const took = useRef(false);
  useEffect(() => {
    if (took.current) return;
    took.current = true;
    const p = takePendingFiles(kind);
    if (!p) return;
    // Sumber eksternal (handoff) sekali saat layar dibuka.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (p.source === 'gallery') onGallery(p.files);
    else addFiles(p.files, p.source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Kembali ke layar (app) sebelumnya lewat navigasi klien (toast tetap tampil, U-11); entri kamera
  // diganti sehingga tombol kembali tidak membuka kamera lagi.
  const leave = () => router.replace(lastAppPath());

  const move = (i: number, d: -1 | 1) =>
    setParts((ps) => {
      const j = i + d;
      if (j < 0 || j >= ps.length) return ps;
      const next = [...ps];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  /** Simpan kelompok bagian sebagai capture di antrean (§5.4 langkah 1). */
  const save = async (groups: { file: File; prepared: Promise<PreparedImage> }[][]) => {
    if (!outbox || groups.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const entries: { item: OutboxItem; blobs: Map<number, Blob> }[] = [];
      let skipped = 0;
      for (const g of groups) {
        const settled = await Promise.allSettled(g.map((p) => p.prepared));
        skipped += settled.filter((r) => r.status === 'rejected').length;
        const ready = settled
          .filter((r): r is PromiseFulfilledResult<PreparedImage> => r.status === 'fulfilled')
          .map((r) => r.value);
        if (ready.length === 0) continue;
        const item = newItem({
          capture_id: newCaptureId(),
          kind,
          household_id: ctx.data?.household.id ?? null,
          shopping_session_id: null,
          store_id: null,
          branch_id: null,
          captured_at: ready[0]!.capturedAt,
          parts: ready.map((r, i) => ({
            position: i + 1,
            ext: r.ext,
            content_type: r.contentType,
            sha256: r.sha256,
            byte_size: r.byteSize,
          })),
        });
        entries.push({ item, blobs: new Map(ready.map((r, i) => [i + 1, r.blob])) });
      }
      if (skipped) setError(`${fill(CAMERA_COPY.gallerySkipped, { n: skipped })} ${CAMERA_COPY.rejected}`);
      if (entries.length === 0) return;
      await outbox.enqueue(entries);
      if (skipped) toast.warning(fill(CAMERA_COPY.gallerySkipped, { n: skipped }));
      const bytes = await outbox.store.totalBytes();
      if (bytes > QUEUE_WARN_BYTES) toast.warning(fill(CAMERA_COPY.queueWarn, { size: formatBytes(bytes) }));
      // U-10: cek hash sebelum unggah (online). Satu capture → dialog di sini; beberapa → di S-08.
      if (navigator.onLine && entries.length === 1) {
        const checked = await outbox.checkDuplicate(entries[0]!.item.capture_id);
        const match = checked?.duplicate.status === 'found' ? checked.duplicate.matches[0] : undefined;
        if (checked && match) {
          setDuplicate({ item: checked, match });
          return;
        }
      }
      finish(entries.length);
    } catch {
      setError(CAMERA_COPY.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const finish = (n: number) => {
    const msg = !navigator.onLine
      ? CAMERA_COPY.toastOffline
      : receipt
        ? n > 1
          ? fill(CAMERA_COPY.toastReceipts, { n })
          : CAMERA_COPY.toastReceipt
        : n > 1
          ? fill(CAMERA_COPY.toastScreenshots, { n })
          : CAMERA_COPY.toastScreenshot;
    flashToast('success', msg);
    leave();
  };

  const preparing = parts.some((p) => p.status === 'preparing');
  const full = parts.length >= MAX_PARTS;

  return (
    <section className="flex min-h-dvh flex-1 flex-col" aria-labelledby="judul-layar">
      <header className="flex items-center gap-2 p-2">
        <Button variant="ghost" size="icon" onClick={leave} aria-label={CAMERA_COPY.back}>
          <ArrowLeft aria-hidden />
        </Button>
        <h1 id="judul-layar" tabIndex={-1} className="text-xl font-semibold">
          {title}
        </h1>
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4">
        <p className="text-base text-muted-foreground">
          {receipt ? (
            <>
              {CAMERA_COPY.guide} {CAMERA_COPY.longHint}
            </>
          ) : (
            CAMERA_COPY.screenshotHint
          )}
        </p>
        {error ? (
          <p role="alert" className="rounded-lg border border-danger p-3 text-sm">
            {error}
          </p>
        ) : null}
        {!online ? (
          <p className="rounded-lg bg-warning p-3 text-sm text-warning-foreground">{CAMERA_COPY.toastOffline}</p>
        ) : null}
        {parts.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg bg-muted p-6 text-center text-muted-foreground">
            <ReceiptText aria-hidden className="mr-2 size-6" />
            {CAMERA_COPY.empty}
          </div>
        ) : null}
      </div>

      {/* ThumbStrip di atas shutter (wireframe S-07). */}
      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-divider bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {parts.length > 0 ? (
          <section aria-label={CAMERA_COPY.parts}>
            <ol className="flex gap-3 overflow-x-auto pb-1" data-testid="thumb-strip">
              {parts.map((p, i) => (
                <li key={p.key} className="flex w-24 shrink-0 flex-col items-center gap-1" data-testid="part">
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob: lokal */}
                  <img
                    src={p.url || undefined}
                    alt={fill(CAMERA_COPY.imageAlt, { n: i + 1 })}
                    className="h-24 w-24 rounded-md bg-muted object-cover"
                  />
                  <span className="text-xs">
                    {fill(CAMERA_COPY.part, { n: i + 1 })}
                    {p.status === 'preparing' ? ` · ${CAMERA_COPY.preparing}` : ''}
                  </span>
                  <span className="flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={fill(CAMERA_COPY.moveUp, { n: i + 1 })}
                    >
                      <ChevronLeft aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={i === parts.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={fill(CAMERA_COPY.moveDown, { n: i + 1 })}
                    >
                      <ChevronRight aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))}
                      aria-label={fill(CAMERA_COPY.remove, { n: i + 1 })}
                    >
                      <X aria-hidden />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
            {full ? <p className="text-sm text-muted-foreground">{CAMERA_COPY.maxParts}</p> : null}
          </section>
        ) : null}

        {/* ShutterBar: galeri kiri, shutter besar tengah, Selesai kanan (U-07). */}
        <div className="grid grid-cols-3 items-center">
          <FileButton
            multiple
            disabled={full || saving}
            onFiles={onGallery}
            className="h-action"
            testId="input-gallery"
          >
            <Images aria-hidden className="size-6" />
            {CAMERA_COPY.gallery}
          </FileButton>
          {receipt ? (
            <FileButton
              capture
              disabled={full || saving}
              onFiles={(f) => addFiles(f, 'camera')}
              className="mx-auto size-20 rounded-full bg-primary text-primary-foreground"
              testId="input-camera"
            >
              {parts.length ? <Plus aria-hidden className="size-7" /> : <ReceiptText aria-hidden className="size-7" />}
              <span className="sr-only">{parts.length ? CAMERA_COPY.addPart : CAMERA_COPY.shutter}</span>
            </FileButton>
          ) : (
            <FileButton
              multiple
              disabled={saving}
              onFiles={onGallery}
              className="mx-auto size-20 rounded-full bg-primary text-center text-xs text-primary-foreground"
              testId="input-screenshot"
            >
              <Images aria-hidden className="size-7" />
              <span className="sr-only">{CAMERA_COPY.pickScreenshot}</span>
            </FileButton>
          )}
          <Button
            className="ml-auto"
            disabled={parts.length === 0 || saving}
            onClick={() => void save([parts])}
            aria-busy={saving || preparing || undefined}
          >
            {saving ? CAMERA_COPY.saving : CAMERA_COPY.done}
          </Button>
        </div>
        {receipt && parts.length > 0 && !full ? (
          <p className="text-center text-sm text-muted-foreground" aria-hidden>
            {CAMERA_COPY.addPart}
          </p>
        ) : null}
      </div>

      <GalleryDialog
        files={galleryFiles}
        kind={kind}
        onCancel={() => setGalleryFiles(null)}
        onChoose={(groups) => {
          setGalleryFiles(null);
          if (groups.length === 1) addFiles(groups[0]!, 'gallery');
          else void save(groups.map((g) => g.map((file) => ({ file, prepared: prepare(file, kind, 'gallery') }))));
        }}
      />
      <DuplicateDialog
        match={duplicate?.match ?? null}
        timeZone={tz}
        onKeep={() => {
          if (duplicate) void outbox?.keepDuplicate(duplicate.item.capture_id);
          setDuplicate(null);
          finish(1);
        }}
        onView={(id) => {
          setDuplicate(null);
          router.replace(`/unggahan/detail?id=${id}`);
        }}
        onDismiss={() => {
          setDuplicate(null);
          leave();
        }}
      />
    </section>
  );
}
