import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignInScreen } from '@/features/auth/sign-in-screen';
import { AUTH_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: AUTH_COPY.title };

export default function Page() {
  return (
    <Suspense>
      <SignInScreen />
    </Suspense>
  );
}
