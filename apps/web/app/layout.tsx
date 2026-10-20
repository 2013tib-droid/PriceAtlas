import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/app/providers';
import { APP_COPY } from '@/lib/copy/id';
import './globals.css';

// Root statis (docs/07 §3.2): tidak membaca cookie/headers, sehingga bisa di-prerender dan
// disajikan service worker saat offline.
export const metadata: Metadata = {
  title: { default: APP_COPY.appName, template: `%s · ${APP_COPY.appName}` },
  description: 'Histori harga pribadi untuk tahu murah atau mahal sebelum membeli.',
  applicationName: APP_COPY.appName,
  appleWebApp: { capable: true, title: APP_COPY.appName, statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

// Tanpa maximum-scale: pinch-zoom tidak diblokir (§10.1).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1f2937',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
