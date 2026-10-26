import type { Metadata } from 'next';
import { ShareScreen } from '@/features/me/share-screen';
import { SETTINGS_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: SETTINGS_COPY.share.title };

export default function Page() {
  return <ShareScreen />;
}
