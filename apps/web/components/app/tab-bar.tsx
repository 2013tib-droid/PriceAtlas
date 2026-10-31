'use client';
// Tab bar: 4 tab + tombol kamera di tengah (U-01, D-47), banner sesi di atasnya (U-13). Slug Indonesia
// (D-79).
import { Camera, ClipboardPaste, Search, ShoppingBasket, Upload, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_COPY, PASTE_COPY } from '@/lib/copy/id';
import { photoCaptureEnabled } from '@/lib/features';
import { cn } from '@/lib/utils';
import { useNeedsCheckCount } from '@/lib/data/queries';
import { fill } from '@/lib/copy/id';
import { PhotoSheet, usePhotoSheet } from './photo-sheet';
import { SessionBanner } from './session-banner';

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

function TabLink({ tab, active, badge = 0 }: { tab: (typeof TABS)[number]; active: boolean; badge?: number }) {
  const Icon = tab.icon;
  return (
    <li className="flex-1">
      <Link
        href={tab.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex h-tabbar flex-col items-center justify-center gap-0.5 text-xs',
          active ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        <Icon aria-hidden className="size-6" strokeWidth={active ? 2.5 : 2} />
        {tab.label}
        {badge > 0 ? (
          <span
            data-testid="uploads-badge"
            className="absolute top-1.5 left-1/2 ml-2 min-w-5 rounded-full bg-danger px-1 text-center text-xs leading-5 font-semibold text-primary-foreground"
          >
            <span aria-hidden>{badge > 99 ? '99+' : badge}</span>
            <span className="sr-only">{`, ${fill(APP_COPY.uploadsBadge, { n: badge })}`}</span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function TabBar() {
  const pathname = usePathname() ?? '/';
  const photo = usePhotoSheet();
  const needsCheck = useNeedsCheckCount().data ?? 0;
  const [left, right] = [TABS.slice(0, 2), TABS.slice(2)];
  return (
    <div className="group fixed inset-x-0 bottom-0 z-30 border-t border-divider bg-surface pb-[env(safe-area-inset-bottom)]">
      {/* Banner sesi di atas tab bar (U-13); tinggi ikut --bottom-bars (globals.css). */}
      <SessionBanner />
      <nav aria-label="Navigasi utama">
        <ul className="mx-auto flex max-w-xl items-stretch">
          {left.map((t) => (
            <TabLink key={t.href} tab={t} active={t.match(pathname)} badge={t.href === '/unggahan' ? needsCheck : 0} />
          ))}
          <li className="flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={photo.open}
              aria-label={photoCaptureEnabled() ? APP_COPY.cameraLabel : PASTE_COPY.cameraLabel}
              className="flex size-14 -translate-y-3 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md group-has-[[data-session-banner]]:translate-y-0"
            >
              {photoCaptureEnabled() ? (
                <Camera aria-hidden className="size-7" />
              ) : (
                <ClipboardPaste aria-hidden className="size-7" />
              )}
            </button>
          </li>
          {right.map((t) => (
            <TabLink key={t.href} tab={t} active={t.match(pathname)} />
          ))}
        </ul>
      </nav>
      <PhotoSheet />
    </div>
  );
}
