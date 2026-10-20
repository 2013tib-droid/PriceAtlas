import type { Metadata } from 'next';
import { SizesScreen } from '@/features/sizes/sizes-screen';

export const metadata: Metadata = { title: 'Bandingkan ukuran' };

export default function Page() {
  return <SizesScreen />;
}
