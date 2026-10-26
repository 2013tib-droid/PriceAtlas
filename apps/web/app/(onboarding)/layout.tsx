import { Suspense, type ReactNode } from 'react';
import { AuthGate } from '@/components/app/app-shell';
import { OfflineStrip } from '@/components/app/offline-strip';

// Onboarding S-00b/S-00c tanpa tab bar dan banner sesi (D-91, Q-100, F-104): user tidak keluar dari
// onboarding lewat tab sebelum status tersimpan. URL tetap `/selamat-datang` (SHELL_ROUTES tetap);
// kerangka statis dan penjaga sesi sama dengan grup (app).
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <div className="flex min-h-dvh flex-col bg-background">
        <OfflineStrip />
        <main id="konten" className="mx-auto w-full max-w-xl flex-1 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <AuthGate>{children}</AuthGate>
        </main>
      </div>
    </Suspense>
  );
}
