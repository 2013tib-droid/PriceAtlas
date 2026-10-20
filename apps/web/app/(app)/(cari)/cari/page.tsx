import type { Metadata } from 'next';
import { SearchScreen } from '@/features/search/search-screen';

export const metadata: Metadata = { title: 'Hasil cari' };

export default function Page() {
  return <SearchScreen />;
}
