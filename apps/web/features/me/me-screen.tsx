'use client';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PlaceholderScreen } from '@/components/app/placeholder-screen';
import { Button } from '@/components/ui/button';
import { APP_COPY, fill } from '@/lib/copy/id';
import { useMyContext } from '@/lib/auth/context';
import { signOutAndClear, useAuth } from '@/lib/auth/session';

/** S-19 Saya (kerangka M0): hanya Keluar. Profil, member, berbagi, privasi di M6. */
export function MeScreen() {
  const auth = useAuth();
  const ctx = useMyContext();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const p = APP_COPY.placeholders.me;
  return (
    <PlaceholderScreen title={p.title} body={p.body}>
      {auth.user?.email ? (
        <p className="text-base" data-testid="signed-in-as">
          {fill(APP_COPY.signedInAs, { email: auth.user.email })}
          {ctx.data ? ` · ${ctx.data.household.name}` : ''}
        </p>
      ) : null}
      <Button
        variant="secondary"
        size="action"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await signOutAndClear(auth.user?.id ?? null);
          router.replace('/masuk');
        }}
      >
        <LogOut aria-hidden />
        {APP_COPY.signOut}
      </Button>
    </PlaceholderScreen>
  );
}
