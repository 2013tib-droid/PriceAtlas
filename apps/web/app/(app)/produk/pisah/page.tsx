import type { Metadata } from 'next';
import { SplitScreen } from '@/features/catalog/split-screen';
import { CATALOG_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: CATALOG_COPY.split.title };

export default function Page() {
  return <SplitScreen />;
}
