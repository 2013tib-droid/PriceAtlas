'use client';
// /kamera?jenis=… (S-07). barcode (M1, D-58), struk dan screenshot (M2, D-82), label (jendela bidik
// tetap terbuka, M4). Jenis lain: pesan + jalan kembali. Foto mati (D-100): hanya barcode; jenis foto
// menampilkan pesan + tautan ke S-21 Tempel struk.
import { ArrowLeft, ClipboardPaste } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { APP_COPY, fill, PASTE_COPY, SCAN_COPY, STATE_COPY } from '@/lib/copy/id';
import { PASTE_HREF, photoCaptureEnabled } from '@/lib/features';
import { CaptureScreen } from '@/features/capture/capture-screen';
import { LabelCamera } from '@/features/capture/label-camera';
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
  if (!photoCaptureEnabled()) return <PhotoOff onBack={() => router.back()} />;
  if (kind === 'struk') return <CaptureScreen kind="receipt" />;
  if (kind === 'screenshot') return <CaptureScreen kind="marketplace" />;
  if (kind === 'label') return <LabelCamera />;
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

function PhotoOff({ onBack }: { onBack: () => void }) {
  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {PASTE_COPY.photoOffTitle}
      </h1>
      <p className="text-base text-muted-foreground">{PASTE_COPY.photoOffBody}</p>
      <Button size="action" asChild>
        <Link href={PASTE_HREF}>
          <ClipboardPaste aria-hidden />
          {PASTE_COPY.goPaste}
        </Link>
      </Button>
      <Button variant="secondary" size="action" onClick={onBack}>
        <ArrowLeft aria-hidden />
        {STATE_COPY.back}
      </Button>
    </section>
  );
}
