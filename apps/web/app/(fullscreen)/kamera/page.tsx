import type { Metadata } from 'next';
import { CameraScreen } from '@/features/scan/camera-screen';

export const metadata: Metadata = { title: 'Kamera' };

export default function Page() {
  return <CameraScreen />;
}
