import type { ReactNode } from 'react';
import { SearchLayout } from '@/features/search/search-layout';

export default function SearchGroupLayout({ children }: { children: ReactNode }) {
  return <SearchLayout>{children}</SearchLayout>;
}
