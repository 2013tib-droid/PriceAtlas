import type { Metadata } from 'next';
import { PlaceholderScreen } from '@/components/app/placeholder-screen';
import { APP_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: APP_COPY.placeholders.shopping.title };

export default function Page() {
  return <PlaceholderScreen {...APP_COPY.placeholders.shopping} />;
}
