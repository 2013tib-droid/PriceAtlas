'use client';
// S-19b Program member (`/saya/member`, docs/07 §7.3, wireframe S-19b, D-10/D-27/D-41): R21 per toko
// dengan toggle; satu toggle = satu W16 (tanpa optimistic update: toggle menunggu hasil). Kalimat
// D-27/D-41 wajib tampil. INVALID_STATE (program dihentikan) → pesan §8.2.
import { useState } from 'react';
import { toast } from 'sonner';
import { SETTINGS_COPY as C, fill } from '@/lib/copy/id';
import { useMyPrograms } from '@/lib/data/confirm';
import { useToggleMembership } from '@/lib/data/settings';
import { membershipError } from '@/lib/settings/account';
import { ProgramList } from './program-list';
import { SubScreen } from './sub-screen';

export function MemberScreen() {
  const programs = useMyPrograms();
  const toggle = useToggleMembership();
  const [error, setError] = useState<string | null>(null);
  return (
    <SubScreen title={C.member.title}>
      <p className="rounded-lg bg-muted p-3 text-base" data-testid="member-intro">
        {C.member.intro}
      </p>
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
        isOn={(p) => p.is_member}
        pendingId={toggle.isPending ? toggle.variables?.programId : null}
        onToggle={(p, member) => {
          setError(null);
          toggle.mutate(
            { programId: p.program_id, member },
            {
              onSuccess: () => toast.success(fill(member ? C.member.on : C.member.off, { name: p.program_name })),
              onError: (e) => setError(membershipError(e)),
            },
          );
        }}
      />
    </SubScreen>
  );
}
