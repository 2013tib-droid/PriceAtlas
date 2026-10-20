'use client';
// Layout grup (app): penjaga sesi di klien + tab bar + strip offline (docs/07 §3.2, §3.5).
// proxy.ts mengalihkan navigasi online; penjaga ini menangani navigasi klien dan mode offline
// (shell disajikan service worker tanpa proxy).
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { AUTH_COPY, APP_COPY } from '@/lib/copy/id';
import { useAuth } from '@/lib/auth/session';
import { useOnline } from '@/lib/hooks/use-online';
import { OfflineStrip } from './offline-strip';
import { TabBar } from './tab-bar';

function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const online = useOnline();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    // navigator.onLine dibaca langsung: saat hidrasi useOnline() masih memberi nilai server (true).
    if (auth.status === 'signed-out' && navigator.onLine) {
      const qs = search?.toString();
      router.replace(`/masuk?next=${encodeURIComponent(pathname + (qs ? `?${qs}` : ''))}`);
    }
  }, [auth.status, online, pathname, router, search]);

  if (auth.status === 'loading') {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy="true">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (auth.status === 'signed-out') {
    return (
      <p className="p-4 text-base text-muted-foreground">{online ? AUTH_COPY.loadingContext : AUTH_COPY.offline}</p>
    );
  }
  return <>{children}</>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#konten" className="sr-only focus:not-sr-only focus:p-2">
        {APP_COPY.skipToContent}
      </a>
      <OfflineStrip />
      <main
        id="konten"
        className="mx-auto w-full max-w-xl flex-1 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom)+1rem)]"
      >
        <AuthGate>{children}</AuthGate>
      </main>
      <TabBar />
    </div>
  );
}
