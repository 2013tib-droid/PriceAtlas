import type { Metadata } from 'next';
import { UploadsScreen } from '@/features/uploads/uploads-screen';
import { UPLOADS_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: UPLOADS_COPY.title };

export default function Page() {
  return <UploadsScreen />;
}
