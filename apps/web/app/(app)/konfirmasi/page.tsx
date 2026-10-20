import type { Metadata } from 'next';
import { ItemsScreen } from '@/features/observation/items-screen';
import { ITEMS_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: ITEMS_COPY.titleLabel };

export default function Page() {
  return <ItemsScreen />;
}
