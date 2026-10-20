'use client';
// /kamera?jenis=… (S-07). M1: hanya `barcode` (D-58, docs/07 §5.7). Struk, label, dan screenshot
// dibuat di M2/M4; sementara layar menjelaskan itu dan menyediakan jalan kembali.
import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { APP_COPY, fill, SCAN_COPY, STATE_COPY } from '@/lib/copy/id';
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
