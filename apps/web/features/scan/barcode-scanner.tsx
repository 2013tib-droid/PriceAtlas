'use client';
// Jendela bidik barcode (D-58, D-82, docs/07 §5.7): getUserMedia kamera belakang, deteksi tiap
// ±150 ms, berhenti saat terbaca → R6 find_product_by_barcode → S-03 (via_merge → toast). Tidak
// dikenal → pesan + cari manual (S-14 "Buat produk baru" ada di M3).
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/app/screen-state';
import { productHref } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { fill, SCAN_COPY, STATE_COPY } from '@/lib/copy/id';
import { findProductByBarcode } from '@/lib/data/queries';
import { createBarcodeDetector, type BarcodeDetectorLike } from '@/lib/media/barcode';

export const SCAN_INTERVAL_MS = 150;

type State =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'looking'; code: string }
  | { kind: 'not-found'; code: string }
  | { kind: 'denied' }
  | { kind: 'unsupported' }
  | { kind: 'error'; error: unknown; code: string };

export function BarcodeScanner() {
  const router = useRouter();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);

  const lookup = useCallback(
    async (code: string) => {
      setState({ kind: 'looking', code });
      try {
        const hit = await findProductByBarcode(qc, code);
        if (!hit) return setState({ kind: 'not-found', code });
        if (hit.via_merge) toast(SCAN_COPY.viaMerge);
        router.replace(productHref(hit.product_id));
      } catch (error) {
        setState({ kind: 'error', error, code });
      }
    },
    [qc, router],
  );

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };

    void (async () => {
      const detector: BarcodeDetectorLike | null = await createBarcodeDetector();
      if (!detector || !navigator.mediaDevices?.getUserMedia) return setState({ kind: 'unsupported' });
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        return setState({ kind: 'denied' });
      }
      if (stopped) return stop();
      const video = videoRef.current;
      if (!video) return stop();
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setState({ kind: 'scanning' });
      const tick = async () => {
        if (stopped) return;
        try {
          const found = await detector.detect(video);
          const code = found[0]?.rawValue?.trim();
          if (code) {
            stop();
            return void lookup(code);
          }
        } catch {
          // Frame belum siap: coba lagi di tick berikutnya.
        }
        timer = setTimeout(() => requestAnimationFrame(() => void tick()), SCAN_INTERVAL_MS);
      };
      void tick();
    })();
    return stop;
  }, [lookup, attempt]);

  const back = () => router.back();
  const searchInstead = () => router.replace('/');

  return (
    <section className="flex flex-1 flex-col gap-4 p-4" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="text-xl font-semibold">
        {SCAN_COPY.title}
      </h1>
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} muted playsInline className="size-full object-cover" aria-hidden />
        <div
          aria-hidden
          className="absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80"
        />
      </div>
      <div role="status" aria-live="polite" className="text-base">
        {state.kind === 'starting' ? SCAN_COPY.starting : null}
        {state.kind === 'scanning' ? SCAN_COPY.hint : null}
        {state.kind === 'looking' ? fill(SCAN_COPY.looking, { code: state.code }) : null}
        {state.kind === 'not-found' ? fill(SCAN_COPY.notFound, { code: state.code }) : null}
        {state.kind === 'denied' ? SCAN_COPY.denied : null}
        {state.kind === 'unsupported' ? SCAN_COPY.unsupported : null}
      </div>
      {state.kind === 'error' ? <ErrorState error={state.error} onRetry={() => void lookup(state.code)} /> : null}
      {/* Kontrol di sepertiga bawah (U-07). */}
      <div className="mt-auto flex flex-col gap-2">
        {state.kind === 'not-found' ? (
          <Button size="action" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {SCAN_COPY.scanAgain}
          </Button>
        ) : null}
        <Button size="action" variant="secondary" onClick={searchInstead}>
          <Search aria-hidden />
          {SCAN_COPY.searchInstead}
        </Button>
        <Button size="action" variant="ghost" onClick={back}>
          <ArrowLeft aria-hidden />
          {STATE_COPY.back}
        </Button>
      </div>
    </section>
  );
}
