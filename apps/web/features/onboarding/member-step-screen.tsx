'use client';
// S-00c Program member saat onboarding (`/selamat-datang/member?next=`, docs/07 §7.3, wireframe S-00c,
// D-27, D-41): ProgramList yang sama dengan S-19b, tetapi pilihan disimpan sekaligus lewat
// "Simpan & lanjut" (W16 per program terpilih, idempoten). "Lewati" tidak menandai apa pun. Keduanya
// menyimpan status onboarding (💾) lalu ke tujuan (S-01 keadaan kosong untuk user baru).
import type { MyProgram } from '@priceatlas/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ProgramList } from '@/features/me/program-list';
import { ONBOARDING_COPY } from '@/lib/copy/id';
import { useMyPrograms } from '@/lib/data/confirm';
import { useJoinPrograms } from '@/lib/data/settings';
import { usePref } from '@/lib/hooks/use-pref';
import { PREF_KEYS } from '@/lib/offline/prefs';
import { membershipError } from '@/lib/settings/account';
import { afterOnboarding } from '@/lib/settings/onboarding';
import { initialSelection, programsToJoin, toggleSelection } from '@/lib/settings/programs';

const C = ONBOARDING_COPY.member;

export function MemberStepScreen() {
  const router = useRouter();
  const next = useSearchParams()?.get('next') ?? null;
  const programs = useMyPrograms();
  const join = useJoinPrograms();
  const onboarded = usePref<boolean>(PREF_KEYS.onboarded, false);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pilihan awal = keanggotaan yang sudah ada, sampai user mengubahnya.
  const selected = picked ?? initialSelection(programs.data);

  const finish = async () => {
    await onboarded.update(() => true);
    router.replace(afterOnboarding(next));
  };

  return (
    <section className="flex flex-col gap-4 p-4 pb-8" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {C.title}
      </h1>
      <p className="text-base">{C.intro}</p>
      {error ? (
        <p role="alert" className="rounded-lg border border-danger p-3 text-sm" data-testid="member-error">
          {error}
        </p>
      ) : null}
      <ProgramList
        programs={programs.data}
        error={programs.error}
        loading={programs.isLoading}
        onRetry={() => void programs.refetch()}
        isOn={(p: MyProgram) => selected.has(p.program_id)}
        onToggle={(p) => setPicked(toggleSelection(selected, p))}
      />
      <p className="text-sm text-muted-foreground">{C.why}</p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="action"
          className="flex-1"
          disabled={join.isPending}
          onClick={() => void finish()}
        >
          {C.skip}
        </Button>
        <Button
          size="action"
          className="flex-1"
          disabled={join.isPending}
          onClick={() => {
            setError(null);
            const ids = programsToJoin(selected, programs.data ?? []);
            if (!ids.length) return void finish();
            join.mutate(ids, {
              onSuccess: () => void finish(),
              onError: (e) => setError(membershipError(e)),
            });
          }}
        >
          {join.isPending ? C.saving : C.save}
        </Button>
      </div>
    </section>
  );
}
