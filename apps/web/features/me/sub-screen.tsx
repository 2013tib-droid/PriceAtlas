'use client';
// Kerangka sub-layar tab Saya (S-19b, S-19c, Privasi): tombol kembali + judul fokus (§10.1).
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { CATALOG_COPY } from '@/lib/copy/id';

export function SubScreen({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <section className="flex flex-col gap-4 p-4 pb-8" aria-labelledby="judul-layar">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft aria-hidden />
          <span className="sr-only">{CATALOG_COPY.record.back}</span>
        </Button>
        <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
          {title}
        </h1>
      </div>
      {children}
    </section>
  );
}
