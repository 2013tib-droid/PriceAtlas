import type { Metadata } from 'next';
import { PrivacyScreen } from '@/features/me/privacy-screen';
import { SETTINGS_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: SETTINGS_COPY.privacy.title };

export default function Page() {
  return <PrivacyScreen />;
}
