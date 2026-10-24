import type { Metadata } from 'next';
import { EditProductScreen } from '@/features/catalog/edit-product-screen';
import { CATALOG_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: CATALOG_COPY.edit.title };

export default function Page() {
  return <EditProductScreen />;
}
