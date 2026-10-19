'use client';
import { SerwistProvider } from '@serwist/turbopack/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth/session';
import { createQueryClient } from '@/lib/data/query-client';

// Service worker mati di `next dev` kecuali NEXT_PUBLIC_SW_DEV=1 (docs/07 §11.5).
const SW_DISABLED = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SW_DEV !== '1';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={SW_DISABLED}
      options={{ scope: '/', type: 'classic' }}
      cacheOnNavigation={false}
      reloadOnOnline={false}
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </QueryClientProvider>
    </SerwistProvider>
  );
}
