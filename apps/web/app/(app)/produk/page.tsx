import type { Metadata } from 'next';
import { ProductScreen } from '@/features/product/product-screen';

export const metadata: Metadata = { title: 'Detail produk' };

export default function Page() {
  return <ProductScreen />;
}
