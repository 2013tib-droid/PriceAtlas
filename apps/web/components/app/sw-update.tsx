'use client';
// Pembaruan service worker (docs/07 §5.2, P-12): SW baru menunggu (`skipWaiting: false`). Banner
// "Versi baru tersedia · Muat ulang"; selama antrean foto belum kosong, pembaruan ditunda (item
// antrean lama tetap dibaca oleh versi yang membuatnya). Muat ulang → SKIP_WAITING (ditangani
// Serwist) → controllerchange → reload.
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { APP_COPY } from '@/lib/copy/id';
import { useOutboxItems } from '@/lib/offline/outbox-context';

export function SwUpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const { items } = useOutboxItems();
  const queueBusy = items.some((i) => i.state !== 'submitted');

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;
    const track = (w: ServiceWorker | null) => {
      if (!w) return;
      const check = () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) setWaiting(w);
      };
      check();
      w.addEventListener('statechange', check);
    };
    const onFound = () => track(reg?.installing ?? null);
    void navigator.serviceWorker.getRegistration().then((r) => {
      reg = r;
      if (!r) return;
      track(r.waiting);
      r.addEventListener('updatefound', onFound);
    });
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      reg?.removeEventListener('updatefound', onFound);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-2 bg-muted px-4 py-2 text-sm">
      <span>{queueBusy ? APP_COPY.update.waitQueue : APP_COPY.update.available}</span>
      {queueBusy ? null : (
        <Button variant="secondary" onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}>
          <RefreshCw aria-hidden />
          {APP_COPY.update.reload}
        </Button>
      )}
    </div>
  );
}
