import type { Metadata } from 'next';
import { LocationScreen } from '@/features/location/location-screen';
import { LOCATION_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: LOCATION_COPY.titleKoreksi };

export default function Page() {
  return <LocationScreen />;
}
