import type { MetadataRoute } from 'next';

// docs/07 §5.1. start_url/scope "/" (S-01). Pintasan menuju layar yang dibuat di M2/M4.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PriceAtlas',
    short_name: 'PriceAtlas',
    description: 'Histori harga pribadi untuk tahu murah atau mahal sebelum membeli.',
    lang: 'id',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1f2937',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Foto struk', url: '/kamera?jenis=struk' },
      { name: 'Mulai belanja', url: '/belanja' },
    ],
  };
}
