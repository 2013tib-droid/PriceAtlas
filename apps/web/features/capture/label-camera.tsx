'use client';
// S-07 kamera label `/kamera?jenis=label` (D-82, P-18, U-07, wireframe S-07 mode Label): jendela bidik
// di app (getUserMedia kamera belakang) yang TETAP terbuka untuk foto berikutnya; shutter besar di
// bawah, galeri kiri, Selesai kanan. Satu foto = satu capture. Frame → canvas → pipeline gambar M2
// (2048 px, JPEG 0,85, sha256) → antrean dengan `shopping_session_id` sesi aktif SAAT foto diambil
// (P-11) → W1. Indikator per foto tanpa meninggalkan kamera. Izin ditolak / kamera tidak ada →
// "Pilih dari galeri". Lokasi: sesi aktif, atau lokasi manual dari S-12 (`toko`, `cabang`; D-28).
// Tanpa keduanya → S-12 mode manual (F-53).
import { ArrowLeft, Camera, Images } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { storeText } from '@/components/price/price';
import { CAMERA_COPY, fill, LABEL_CAMERA_COPY as C } from '@/lib/copy/id';
import { useMyContext } from '@/lib/auth/context';
import { useLocationNames } from '@/lib/data/confirm';
import { activeSessionNow, useActiveSession } from '@/lib/data/session';
import { flashToast } from '@/lib/flash';
import { lastAppPath } from '@/lib/hooks/last-app-path';
import { useNow } from '@/lib/hooks/use-now';
import { useOnline } from '@/lib/hooks/use-online';
import { newCaptureId } from '@/lib/media/capture-id';
import type { PreparedImage } from '@/lib/media/prepare';
import { useOutboxHandle } from '@/lib/offline/outbox-context';
import { newItem } from '@/lib/offline/outbox-store';
import { labelLocationHref, manualLocationFrom } from '@/lib/session/label-target';
import { activeOrNull, sessionPlace } from '@/lib/session/session';
import { cn } from '@/lib/utils';
import { FileButton } from './file-button';

type CameraState = 'starting' | 'live' | 'denied' | 'unavailable';
type ShotState = 'preparing' | 'saved' | 'offline' | 'failed';
interface Shot {
  key: number;
  url: string | null;
  state: ShotState;
}

const SHOT_TEXT: Record<ShotState, string> = {
  preparing: C.preparing,
  saved: C.saved,
  offline: C.savedOffline,
  failed: C.failedOne,
};

/** Pipeline frame/galeri dimuat saat dibutuhkan (dynamic import, D-84). */
const media = () => import('@/lib/media/frame');

/** Kamera belakang (P-18). Izin ditolak (NotAllowed/Security) dibedakan dari kamera tidak ada. */
export async function openCamera(): Promise<{ stream: MediaStream } | { error: 'denied' | 'unavailable' }> {
  if (!navigator.mediaDevices?.getUserMedia) return { error: 'unavailable' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    return { stream };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return { error: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable' };
  }
}

export function LabelCamera() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const outbox = useOutboxHandle();
  const ctx = useMyContext();
  const online = useOnline();
  const now = useNow(15_000);
  const session = useActiveSession();
  const manual = manualLocationFrom(params);
  const names = useLocationNames(manual ? [manual.storeId] : [], manual?.branchId ? [manual.branchId] : []);
  const active = activeOrNull(session.data, now);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [shots, setShots] = useState<Shot[]>([]);
  const [announce, setAnnounce] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noLocation, setNoLocation] = useState(false);
  /** Nomor foto di kunjungan kamera ini (dipakai di handler saja). */
  const seq = useRef(0);

  // Belum ada sesi maupun lokasi manual: pilih lokasi dulu (S-12 mode manual), selama belum memotret.
  const checking = !manual && session.data === undefined && !session.isError && online;
  const needsLocation = !manual && !checking && !active && shots.length === 0;
  useEffect(() => {
    if (needsLocation) router.replace(labelLocationHref());
  }, [needsLocation, router]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    void (async () => {
      const r = await openCamera();
      if ('error' in r) {
        if (!stopped) setCamera(r.error);
        return;
      }
      stream = r.stream;
      const video = videoRef.current;
      if (stopped || !video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      if (!stopped) setCamera('live');
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const place = manual
    ? storeText(
        { name: names.store(manual.storeId)?.name ?? '…' },
        manual.branchId ? { name: names.branch(manual.branchId)?.name ?? '…' } : null,
      )
    : active
      ? sessionPlace(active)
      : null;

  const patchShot = (key: number, patch: Partial<Shot>) =>
    setShots((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  /** Simpan satu foto label ke antrean (§5.4 langkah 1) dengan lokasi saat ini (P-11). */
  const save = async (key: number, prepared: PreparedImage) => {
    if (!outbox) throw new Error('antrean belum siap');
    const s = manual ? null : activeSessionNow(qc);
    if (!manual && !s) setNoLocation(true);
    const item = newItem({
      capture_id: newCaptureId(),
      kind: 'price_label',
      household_id: ctx.data?.household.id ?? null,
      shopping_session_id: s?.session.id ?? null,
      store_id: manual?.storeId ?? null,
      branch_id: manual?.branchId ?? null,
      captured_at: prepared.capturedAt,
      parts: [
        {
          position: 1,
          ext: prepared.ext,
          content_type: prepared.contentType,
          sha256: prepared.sha256,
          byte_size: prepared.byteSize,
        },
      ],
    });
    await outbox.enqueue([{ item, blobs: new Map([[1, prepared.blob]]) }]);
    const offline = !navigator.onLine;
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(prepared.blob) : null;
    patchShot(key, { state: offline ? 'offline' : 'saved', url });
    setAnnounce(fill(offline ? C.announceOffline : C.announceSaved, { n: key }));
  };

  const run = async (make: () => Promise<PreparedImage>) => {
    const key = ++seq.current;
    setError(null);
    setShots((ss) => [...ss, { key, url: null, state: 'preparing' }]);
    try {
      await save(key, await make());
    } catch {
      patchShot(key, { state: 'failed' });
      setError(C.failed);
    }
  };

  const shoot = () => {
    const video = videoRef.current;
    if (!video || camera !== 'live') return;
    void run(async () => (await media()).prepareLabelFrame(video));
  };

  const onGallery = (files: File[]) => {
    for (const f of files) void run(async () => (await media()).prepareLabelFile(f));
  };

  const done = shots.filter((s) => s.state === 'saved' || s.state === 'offline').length;
  const leave = () => {
    if (done > 0) flashToast('success', fill(navigator.onLine ? C.toastDone : C.toastDoneOffline, { n: done }));
    router.replace(lastAppPath());
  };

  const cameraBlocked = camera === 'denied' || camera === 'unavailable';
  const busy = shots.some((s) => s.state === 'preparing');

  return (
    <section className="flex min-h-dvh flex-1 flex-col bg-background" aria-labelledby="judul-layar">
      <header className="flex items-center gap-2 p-2">
        <Button variant="ghost" size="icon" onClick={leave} aria-label={C.back}>
          <ArrowLeft aria-hidden />
        </Button>
        <div className="flex min-w-0 flex-col">
          <h1 id="judul-layar" tabIndex={-1} className="text-xl font-semibold">
            {C.title}
          </h1>
          <p className="truncate text-sm text-muted-foreground" data-testid="label-target">
            {checking ? C.checking : place ? fill(manual ? C.targetManual : C.targetSession, { place }) : null}
          </p>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-2 px-4">
        {noLocation ? (
          <p role="alert" className="rounded-lg border border-danger p-3 text-sm">
            {C.sessionEnded}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-danger p-3 text-sm">
            {error}
          </p>
        ) : null}
        {!online ? (
          <p className="rounded-lg bg-warning p-3 text-sm text-warning-foreground">{CAMERA_COPY.toastOffline}</p>
        ) : null}
        <div className="relative min-h-64 flex-1 overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            aria-hidden
            data-testid="viewfinder"
            className={cn('size-full object-cover', cameraBlocked && 'hidden')}
          />
          {camera === 'live' ? (
            <div aria-hidden className="absolute inset-8 rounded-lg border-2 border-white/80" />
          ) : null}
          {cameraBlocked ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-muted p-6 text-center">
              <p className="text-base text-foreground">{camera === 'denied' ? C.denied : C.unavailable}</p>
              <FileButton
                multiple
                onFiles={onGallery}
                className="h-action flex-row rounded-lg bg-primary px-4 text-base text-primary-foreground"
                testId="label-gallery-fallback"
              >
                <Images aria-hidden className="size-5" />
                {C.pickGallery}
              </FileButton>
            </div>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{camera === 'starting' ? C.starting : C.hint}</p>
        <p role="status" aria-live="polite" className="sr-only">
          {announce}
        </p>
      </div>

      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-divider bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {shots.length > 0 ? (
          <section aria-label={C.taken}>
            <ol className="flex gap-2 overflow-x-auto pb-1" data-testid="label-shots">
              {shots.map((s) => (
                <li key={s.key} className="flex w-16 shrink-0 flex-col items-center gap-1" data-testid="label-shot">
                  {s.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- blob: lokal
                    <img src={s.url} alt="" className="size-16 rounded-md bg-muted object-cover" />
                  ) : (
                    <span aria-hidden className="size-16 rounded-md bg-muted" />
                  )}
                  <span className="text-center text-xs">{fill(C.thumb, { n: s.key, state: SHOT_TEXT[s.state] })}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {/* ShutterBar: galeri kiri, shutter besar tengah, Selesai kanan (U-07). */}
        <div className="grid grid-cols-3 items-center">
          <FileButton multiple onFiles={onGallery} className="h-action" testId="label-gallery">
            <Images aria-hidden className="size-6" />
            {C.gallery}
          </FileButton>
          <button
            type="button"
            onClick={shoot}
            disabled={camera !== 'live' || !outbox || needsLocation}
            className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
            aria-label={C.shutter}
          >
            <Camera aria-hidden className="size-8" />
          </button>
          <Button className="ml-auto" onClick={leave} aria-busy={busy || undefined}>
            {C.done}
          </Button>
        </div>
      </div>
    </section>
  );
}
