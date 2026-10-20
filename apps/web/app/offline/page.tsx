import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { APP_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: APP_COPY.offlinePage.title };

/** Fallback service worker untuk navigasi yang belum tersimpan (docs/07 §5.2, §7.1). */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-4 p-4 pb-8">
      <h1 className="text-2xl font-semibold">{APP_COPY.offlinePage.title}</h1>
      <p className="text-base text-muted-foreground">{APP_COPY.offlinePage.body}</p>
      <Link href="/" className={buttonVariants({ size: 'action' })}>
        {APP_COPY.offlinePage.home}
      </Link>
    </main>
  );
}
