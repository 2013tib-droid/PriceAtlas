import type { Metadata } from 'next';
import { AskScreen } from '@/features/ask/ask-screen';
import { ASK_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: ASK_COPY.title };

export default function Page() {
  return <AskScreen />;
}
