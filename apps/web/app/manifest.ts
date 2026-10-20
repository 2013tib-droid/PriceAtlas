import type { MetadataRoute } from 'next';

// docs/07 §5.1. start_url/scope "/" (S-01). Pintasan: Foto struk (S-07, M2), Mulai belanja (S-13).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
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
    categories: ['shopping', 'finance', 'utilities'],
    prefer_related_applications: false,
    shortcuts: [
      {
        name: 'Foto struk',
        short_name: 'Struk',
        url: '/kamera?jenis=struk',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Mulai belanja',
        short_name: 'Belanja',
        url: '/belanja',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
