'use client';
import { PlaceholderScreen } from '@/components/app/placeholder-screen';
import { APP_COPY, fill } from '@/lib/copy/id';
import { useMyContext } from '@/lib/auth/context';
import { useAuth } from '@/lib/auth/session';

/** S-01 Beranda / Cari (kerangka M0). Isi search dibuat di M1. */
export function HomeScreen() {
  const auth = useAuth();
  const ctx = useMyContext();
  const p = APP_COPY.placeholders.search;
  return (
    <PlaceholderScreen title={p.title} body={p.body}>
      {auth.user?.email ? (
        <p className="text-sm text-muted-foreground" data-testid="signed-in-as">
          {fill(APP_COPY.signedInAs, { email: auth.user.email })}
          {ctx.data ? ` · ${ctx.data.household.name}` : ''}
        </p>
      ) : null}
    </PlaceholderScreen>
  );
}
