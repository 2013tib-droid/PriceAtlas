'use client';
// S-00b Selamat datang (`/selamat-datang?next=`, docs/07 §3.5, §7.3, wireframe S-00b): nilai produk
// dalam satu layar. Semua login lewat sini (lib/settings/onboarding.ts); jika status "sudah dilihat"
// (💾 prefs `onboarded`) sudah ada di perangkat ini, layar langsung meneruskan ke tujuan.
// "Mulai" → S-00c. "Lewati" → status disimpan, langsung ke tujuan (S-01).
import { Check } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ONBOARDING_COPY } from '@/lib/copy/id';
import { usePref } from '@/lib/hooks/use-pref';
import { PREF_KEYS } from '@/lib/offline/prefs';
import { afterOnboarding, memberStepHref } from '@/lib/settings/onboarding';

const C = ONBOARDING_COPY.welcome;

export function WelcomeScreen() {
  const router = useRouter();
  const next = useSearchParams()?.get('next') ?? null;
  const onboarded = usePref<boolean>(PREF_KEYS.onboarded, false);
  const done = onboarded.ready && onboarded.value;

  useEffect(() => {
    if (done) router.replace(afterOnboarding(next));
  }, [done, next, router]);

  if (!onboarded.ready || done) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-5 p-4 pb-8" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {C.title}
      </h1>
      <p className="text-base">{C.body}</p>
      <ul className="flex flex-col gap-2">
        {C.points.map((t) => (
          <li key={t} className="flex items-start gap-2 text-base">
            <Check aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">{C.note}</p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="action"
          className="flex-1"
          onClick={async () => {
            await onboarded.update(() => true);
            router.replace(afterOnboarding(next));
          }}
        >
          {C.skip}
        </Button>
        <Button size="action" className="flex-1" onClick={() => router.push(memberStepHref(next))}>
          {C.start}
        </Button>
      </div>
    </section>
  );
}
