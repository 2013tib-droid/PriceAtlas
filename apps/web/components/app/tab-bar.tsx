'use client';
// Tab bar: 4 tab + tombol kamera di tengah (U-01, D-47). Slug Indonesia (D-79).
import { Camera, Search, ShoppingBasket, Upload, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { APP_COPY } from '@/lib/copy/id';
import { cn } from '@/lib/utils';
import { PhotoSheet } from './photo-sheet';

export const TABS = [
  {
    href: '/',
    label: APP_COPY.tabs.search,
    icon: Search,
    match: (p: string) => p === '/' || p.startsWith('/cari') || p.startsWith('/produk'),
  },
  { href: '/unggahan', label: APP_COPY.tabs.uploads, icon: Upload, match: (p: string) => p.startsWith('/unggahan') },
  {
    href: '/belanja',
    label: APP_COPY.tabs.shopping,
    icon: ShoppingBasket,
    match: (p: string) => p.startsWith('/belanja'),
  },
  { href: '/saya', label: APP_COPY.tabs.me, icon: User, match: (p: string) => p.startsWith('/saya') },
] as const;

function TabLink({ tab, active }: { tab: (typeof TABS)[number]; active: boolean }) {
  const Icon = tab.icon;
  return (
    <li className="flex-1">
      <Link
        href={tab.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-tabbar flex-col items-center justify-center gap-0.5 text-xs',
          active ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        <Icon aria-hidden className="size-6" strokeWidth={active ? 2.5 : 2} />
        {tab.label}
      </Link>
    </li>
  );
}

export function TabBar() {
  const pathname = usePathname() ?? '/';
  const [photoOpen, setPhotoOpen] = useState(false);
  const [left, right] = [TABS.slice(0, 2), TABS.slice(2)];
  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-divider bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-xl items-stretch">
        {left.map((t) => (
          <TabLink key={t.href} tab={t} active={t.match(pathname)} />
        ))}
        <li className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            aria-label={APP_COPY.cameraLabel}
            className="flex size-14 -translate-y-3 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md"
          >
            <Camera aria-hidden className="size-7" />
          </button>
        </li>
        {right.map((t) => (
          <TabLink key={t.href} tab={t} active={t.match(pathname)} />
        ))}
      </ul>
      <PhotoSheet open={photoOpen} onOpenChange={setPhotoOpen} />
    </nav>
  );
}
