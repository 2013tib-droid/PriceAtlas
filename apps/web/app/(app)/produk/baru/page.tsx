import type { Metadata } from 'next';
import { NewProductScreen } from '@/features/new-product/new-product-screen';
import { NEW_PRODUCT_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: NEW_PRODUCT_COPY.title };

export default function Page() {
  return <NewProductScreen />;
}
