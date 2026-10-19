import type { NextConfig } from 'next';

// Tahap 4: scaffold saja. Tidak ada halaman UI (Tahap 5); hanya Route Handler
// operasi bersecret (D-61): POST /api/account/delete.
const config: NextConfig = {
  transpilePackages: ['@priceatlas/contracts'],
  typedRoutes: false,
};

export default config;
