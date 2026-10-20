import type { Metadata } from 'next';
import { ReceiptScreen } from '@/features/receipt/receipt-screen';
import { RECEIPT_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: RECEIPT_COPY.title };

export default function Page() {
  return <ReceiptScreen />;
}
