import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';

// D-79: shell statis + data di klien. Server Next.js hanya untuk proxy.ts (segarkan sesi),
// /auth/callback (PKCE Google), dan Route Handler bersecret (D-61).
const config: NextConfig = {
  transpilePackages: ['@priceatlas/contracts'],
  typedRoutes: false,
  poweredByHeader: false,
  async headers() {
    // docs/07 §11.6. CSP menyusul bersama URL Storage (M2).
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

// D-81: Serwist versi Turbopack membangun service worker lewat Route Handler
// app/serwist/[path]/route.ts; withSerwist hanya menandai esbuild sebagai paket server eksternal.
export default withSerwist(config);
