import type { Metadata } from 'next';
import { RecordScreen } from '@/features/record/record-screen';
import { CATALOG_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: CATALOG_COPY.record.title };

export default function Page() {
  return <RecordScreen />;
}
