import { Suspense, type ReactNode } from 'react';
import { AppShell } from '@/components/app/app-shell';

// Kerangka statis (D-79): tidak membaca cookie, sehingga setiap layar bisa di-prerender dan
// disajikan service worker saat offline.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
