import type { Metadata } from 'next';
import { MergeScreen } from '@/features/catalog/merge-screen';
import { CATALOG_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: CATALOG_COPY.merge.title };

export default function Page() {
  return <MergeScreen />;
}
