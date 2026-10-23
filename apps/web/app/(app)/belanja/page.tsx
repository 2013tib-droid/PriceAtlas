import type { Metadata } from 'next';
import { ShoppingScreen } from '@/features/shopping/shopping-screen';
import { SHOPPING_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: SHOPPING_COPY.title };

export default function Page() {
  return <ShoppingScreen />;
}
