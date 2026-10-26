import type { Metadata } from 'next';
import { MemberScreen } from '@/features/me/member-screen';
import { SETTINGS_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: SETTINGS_COPY.member.title };

export default function Page() {
  return <MemberScreen />;
}
