import type { Metadata } from 'next';
import { UploadDetailScreen } from '@/features/uploads/upload-detail-screen';
import { UPLOAD_DETAIL_COPY } from '@/lib/copy/id';

export const metadata: Metadata = { title: UPLOAD_DETAIL_COPY.title };

export default function Page() {
  return <UploadDetailScreen />;
}
