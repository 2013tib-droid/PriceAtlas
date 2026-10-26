'use client';
// S-19c Berbagi harga publik (`/saya/berbagi`, docs/07 §7.3, wireframe S-19c, docs/05 §4.6, D-51):
// status dari R1 `share_prices_public` (default mati). Menyalakan → W14(true) langsung (data lama tidak
// disentuh). Mematikan → dialog konfirmasi → W14(false) → `withdrawn_count`. "Bagikan juga data lama"
// → W15 → `eligible_count` (job bertahap; INVALID_STATE jika opt-in mati).
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingState } from '@/components/app/screen-state';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useMyContext } from '@/lib/auth/context';
import { SETTINGS_COPY, fill } from '@/lib/copy/id';
import { useSetSharePublic, useShareExisting } from '@/lib/data/settings';
import { shareError } from '@/lib/settings/account';
import { SubScreen } from './sub-screen';

const C = SETTINGS_COPY.share;

export function ShareScreen() {
  const ctx = useMyContext();
  const set = useSetSharePublic();
  const existing = useShareExisting();
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const on = ctx.data?.household.share_prices_public ?? false;

  const turn = (enabled: boolean) => {
    setError(null);
    set.mutate(enabled, {
      onSuccess: (r) => {
        setConfirmOff(false);
        if (enabled) toast.success(C.enabled);
        else {
          setQueued(null);
          toast.success(r.withdrawn_count > 0 ? fill(C.withdrawn, { n: r.withdrawn_count }) : C.disabled);
        }
      },
      onError: (e) => {
        setConfirmOff(false);
        setError(shareError(e));
      },
    });
  };

  if (!ctx.data) {
    return (
      <SubScreen title={C.title}>
        {ctx.isError ? (
          <ErrorState error={ctx.error} onRetry={() => void ctx.refetch()} />
        ) : (
          <LoadingState>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-32 w-full" />
          </LoadingState>
        )}
      </SubScreen>
    );
  }

  return (
    <SubScreen title={C.title}>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
        <label htmlFor="berbagi-publik" className="flex flex-1 flex-col">
          <span className="text-base font-medium">{C.toggle}</span>
          <span className="text-sm text-muted-foreground" data-testid="share-state">
            {on ? C.onNote : C.offNote}
          </span>
        </label>
        <Switch
          id="berbagi-publik"
          checked={on}
          disabled={set.isPending}
          onCheckedChange={(next) => (next ? turn(true) : setConfirmOff(true))}
        />
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-danger p-3 text-sm" data-testid="share-error">
          {error}
        </p>
      ) : null}
      {on ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
          <p className="text-sm">{C.existingHelp}</p>
          <Button
            variant="secondary"
            className="self-start"
            disabled={existing.isPending}
            data-testid="share-existing"
            onClick={() => {
              setError(null);
              existing.mutate(undefined, {
                onSuccess: (r) =>
                  setQueued(r.eligible_count > 0 ? fill(C.existingQueued, { n: r.eligible_count }) : C.existingNone),
                onError: (e) => setError(shareError(e)),
              });
            }}
          >
            {C.existing}
          </Button>
          {queued ? (
            <p role="status" className="text-sm" data-testid="share-queued">
              {queued}
            </p>
          ) : null}
        </div>
      ) : null}
      <section aria-labelledby="dibagikan" className="flex flex-col gap-1">
        <h2 id="dibagikan" className="text-base font-semibold">
          {C.sharedTitle}
        </h2>
        <ul className="list-disc pl-5 text-base">
          {C.shared.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="tidak-dibagikan" className="flex flex-col gap-1">
        <h2 id="tidak-dibagikan" className="text-base font-semibold">
          {C.neverTitle}
        </h2>
        <ul className="list-disc pl-5 text-base">
          {C.never.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <Dialog open={confirmOff} onOpenChange={(v) => !set.isPending && setConfirmOff(v)}>
        <DialogContent>
          <div className="flex flex-col gap-4">
            <DialogTitle>{C.offTitle}</DialogTitle>
            <DialogDescription>{C.offBody}</DialogDescription>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmOff(false)}>
                {C.offCancel}
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={set.isPending}
                onClick={() => turn(false)}
                data-testid="share-off-confirm"
              >
                {C.offConfirm}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SubScreen>
  );
}
