'use client';
import { WifiOff } from 'lucide-react';
import { APP_COPY } from '@/lib/copy/id';
import { useOnline } from '@/lib/hooks/use-online';

/** "Offline. Foto tetap tersimpan dan diunggah otomatis." (docs/07 §7.2, U-17) */
export function OfflineStrip() {
  const online = useOnline();
  return (
    <div role="status" aria-live="polite">
      {online ? null : (
        <p className="flex items-center gap-2 bg-warning px-4 py-2 text-sm text-warning-foreground">
          <WifiOff aria-hidden className="size-4 shrink-0" />
          {APP_COPY.offlineStrip}
        </p>
      )}
    </div>
  );
}
