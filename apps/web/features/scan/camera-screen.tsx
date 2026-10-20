'use client';
// /kamera?jenis=… (S-07). barcode (M1, D-58), struk dan screenshot (M2, D-82). Kamera label
// (jendela bidik) dibuat di M4; sementara layar menjelaskan itu dan menyediakan jalan kembali.
import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { APP_COPY, fill, SCAN_COPY, STATE_COPY } from '@/lib/copy/id';
import { CaptureScreen } from '@/features/capture/capture-screen';
import { BarcodeScanner } from './barcode-scanner';

const KIND_LABEL: Record<string, string> = {
  struk: APP_COPY.photoOptions.receipt,
  label: APP_COPY.photoOptions.label,
  screenshot: APP_COPY.photoOptions.screenshot,
};

export function CameraScreen() {
  const router = useRouter();
  const kind = useSearchParams()?.get('jenis') ?? 'barcode';
  if (kind === 'barcode') return <BarcodeScanner />;
  if (kind === 'struk') return <CaptureScreen kind="receipt" />;
  if (kind === 'screenshot') return <CaptureScreen kind="marketplace" />;
  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {KIND_LABEL[kind] ?? APP_COPY.tabs.camera}
      </h1>
      <p className="text-base text-muted-foreground">
        {fill(SCAN_COPY.cameraSoon, { kind: (KIND_LABEL[kind] ?? kind).toLowerCase() })}
      </p>
      <Button variant="secondary" size="action" onClick={() => router.back()}>
        <ArrowLeft aria-hidden />
        {STATE_COPY.back}
      </Button>
    </section>
  );
}
