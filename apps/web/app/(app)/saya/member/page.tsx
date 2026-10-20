import type { Metadata } from 'next';
import { PlaceholderScreen } from '@/components/app/placeholder-screen';
import { APP_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: 'Program member' };

// S-19b dibuat di M6. Tautan "Atur" pada petunjuk member tidak dihitung (D-27) sudah mengarah ke sini.
export default function Page() {
  const p = APP_COPY.placeholders.member;
  return <PlaceholderScreen title={p.title} body={p.body} />;
}
