import type { Metadata } from 'next';
import { MeScreen } from '@/features/me/me-screen';
import { APP_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: APP_COPY.placeholders.me.title };

export default function Page() {
  return <MeScreen />;
}
