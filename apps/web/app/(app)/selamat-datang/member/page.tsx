import type { Metadata } from 'next';
import { MemberStepScreen } from '@/features/onboarding/member-step-screen';
import { ONBOARDING_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: ONBOARDING_COPY.member.title };

export default function Page() {
  return <MemberStepScreen />;
}
