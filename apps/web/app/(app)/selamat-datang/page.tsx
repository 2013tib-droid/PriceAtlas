import type { Metadata } from 'next';
import { WelcomeScreen } from '@/features/onboarding/welcome-screen';

export const metadata: Metadata = { title: 'Selamat datang' };

export default function Page() {
  return <WelcomeScreen />;
}
