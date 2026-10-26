import type { Metadata } from 'next';
import { MeScreen } from '@/features/me/me-screen';
import { SETTINGS_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: SETTINGS_COPY.me.title };

export default function Page() {
  return <MeScreen />;
}
