'use client';
// ProgramList (docs/07 §7.2, wireframe S-19b/S-00c): program member R21 per toko dengan toggle.
// Program dihentikan: label "program dihentikan" (teks, U-15) dan tidak bisa ditandai; keanggotaan
// lama tetap bisa dilepas. Status tiap toggle juga sebagai teks untuk pembaca layar.
import type { MyProgram } from '@priceatlas/contracts';
import { useId } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/screen-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SETTINGS_COPY as C } from '@/lib/copy/id';
import { canToggle, groupByStore } from '@/lib/settings/programs';

export function ProgramList({
  programs,
  error,
  loading,
  onRetry,
  isOn,
  onToggle,
  pendingId,
}: {
  programs: readonly MyProgram[] | undefined;
  error: unknown;
  loading: boolean;
  onRetry: () => void;
  /** Status toggle (S-19b: is_member; S-00c: pilihan lokal). */
  isOn: (p: MyProgram) => boolean;
  onToggle: (p: MyProgram, next: boolean) => void;
  /** Toggle yang sedang menunggu W16 (dinonaktifkan sementara). */
  pendingId?: string | null;
}) {
  if (!programs && loading) {
    return (
      <LoadingState>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </LoadingState>
    );
  }
  if (!programs) return <ErrorState error={error} message={C.member.loadFailed} onRetry={onRetry} />;
  if (!programs.length) return <EmptyState message={C.member.empty} />;
  return (
    <div className="flex flex-col gap-4" data-testid="program-list">
      {error ? <ErrorState error={error} compact onRetry={onRetry} /> : null}
      {groupByStore(programs).map((g) => (
        <section key={g.storeId} aria-label={g.storeName} className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-muted-foreground">{g.storeName}</h2>
          <ul className="flex flex-col divide-y divide-divider rounded-lg border border-border bg-surface">
            {g.programs.map((p) => (
              <ProgramRow
                key={p.program_id}
                program={p}
                on={isOn(p)}
                pending={pendingId === p.program_id}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </section>
      ))}
      <p className="text-sm text-muted-foreground">{C.member.missing}</p>
    </div>
  );
}

function ProgramRow({
  program: p,
  on,
  pending,
  onToggle,
}: {
  program: MyProgram;
  on: boolean;
  pending: boolean;
  onToggle: (p: MyProgram, next: boolean) => void;
}) {
  const id = useId();
  const discontinued = p.status === 'discontinued';
  // Program dihentikan yang belum diikuti tidak bisa ditandai (W16 → INVALID_STATE).
  const disabled = pending || (!on && !canToggle(p));
  return (
    <li className="flex items-center gap-3 px-3 py-2" data-testid={`program-${p.program_id}`}>
      <label htmlFor={id} className="flex flex-1 flex-col">
        <span className="text-base font-medium">{p.program_name}</span>
        <span className="text-sm text-muted-foreground">
          {p.store.name}
          {discontinued ? ` · ${C.member.discontinued}` : ''}
        </span>
      </label>
      <Switch id={id} checked={on} disabled={disabled} onCheckedChange={(next) => onToggle(p, next)} />
    </li>
  );
}
