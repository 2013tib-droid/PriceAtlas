import type { Metadata } from 'next';
import { CheaperScreen } from '@/features/cheaper/cheaper-screen';

export const metadata: Metadata = { title: 'Lebih hemat di mana' };

export default function Page() {
  return <CheaperScreen />;
}
