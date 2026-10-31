import type { Metadata } from 'next';
import { PasteScreen } from '@/features/paste/paste-screen';
import { PASTE_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: PASTE_COPY.title };

export default function Page() {
  return <PasteScreen />;
}
