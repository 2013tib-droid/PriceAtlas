'use client';
// Pembaruan service worker (docs/07 §5.2, P-12): SW baru menunggu (`skipWaiting: false`). Banner
// "Versi baru tersedia · Muat ulang"; selama antrean foto belum kosong, pembaruan ditunda (item
// antrean lama tetap dibaca oleh versi yang membuatnya). Muat ulang → SKIP_WAITING (ditangani
// Serwist) → controllerchange → reload. PWA yang lama terbuka memeriksa versi baru saat kembali
// terlihat (paling sering sekali per jam, M7).
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { APP_COPY } from '@/lib/copy/id';
import { useOutboxItems } from '@/lib/offline/outbox-context';
import { shouldCheckForUpdate, updateBanner } from '@/lib/offline/sw-rules';

export function SwUpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadRequested = useRef(false);
  const { items } = useOutboxItems();
  const queueBusy = items.some((i) => i.state !== 'submitted');

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    let reg: ServiceWorkerRegistration | undefined;
    const track = (w: ServiceWorker | null) => {
      if (!w) return;
      const check = () => {
        if (w.state === 'installed' && sw.controller) setWaiting(w);
      };
      check();
      w.addEventListener('statechange', check);
    };
    const onFound = () => track(reg?.installing ?? null);
    void sw.getRegistration().then((r) => {
      reg = r;
      if (!r) return;
      track(r.waiting);
      r.addEventListener('updatefound', onFound);
    });
    let lastCheck = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (!shouldCheckForUpdate(lastCheck, Date.now())) return;
      lastCheck = Date.now();
      void reg?.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    // Hanya setelah user memilih "Muat ulang": controllerchange juga terjadi saat SW pertama kali
    // mengambil alih halaman (clientsClaim), dan itu tidak boleh memuat ulang.
    const onControllerChange = () => {
      if (!reloadRequested.current) return;
      reloadRequested.current = false;
      window.location.reload();
    };
    sw.addEventListener('controllerchange', onControllerChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      reg?.removeEventListener('updatefound', onFound);
      sw.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const banner = updateBanner({ waiting: waiting !== null, queueBusy });
  if (banner === 'hidden' || !waiting) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-2 bg-muted px-4 py-2 text-sm">
      <span>{banner === 'wait_queue' ? APP_COPY.update.waitQueue : APP_COPY.update.available}</span>
      {banner === 'wait_queue' ? null : (
        <Button
          variant="secondary"
          onClick={() => {
            reloadRequested.current = true;
            waiting.postMessage({ type: 'SKIP_WAITING' });
          }}
        >
          <RefreshCw aria-hidden />
          {APP_COPY.update.reload}
        </Button>
      )}
    </div>
  );
}
