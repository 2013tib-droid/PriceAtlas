import { Suspense, type ReactNode } from 'react';
import { AuthGate } from '@/components/app/app-shell';
import { OfflineStrip } from '@/components/app/offline-strip';

// Layar penuh tanpa tab bar (S-07 kamera, docs/07 §7.1). Kerangka statis seperti grup (app).
export default function FullscreenLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <div className="flex min-h-dvh flex-col bg-background">
        <OfflineStrip />
        <main id="konten" className="mx-auto flex w-full max-w-xl flex-1 flex-col">
          <AuthGate>{children}</AuthGate>
        </main>
      </div>
    </Suspense>
  );
}
