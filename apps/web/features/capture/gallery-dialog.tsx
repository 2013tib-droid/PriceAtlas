'use client';
// S-07b Pilih dari galeri (U-09): lebih dari 1 gambar → "5 struk berbeda" / "1 struk panjang" /
// "Atur sendiri". Screenshot: "beberapa screenshot berbeda" menjadi pilihan default (pertama).
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CAMERA_COPY, fill } from '@/lib/copy/id';
import type { CaptureKind } from '@/lib/media/image-plan';

/** Kelompok gambar → capture. Nomor kelompok sama = satu capture, urut sesuai urutan file. */
export function groupFiles<T>(files: readonly T[], groupOf: readonly number[]): T[][] {
  const groups = new Map<number, T[]>();
  files.forEach((f, i) => {
    const g = groupOf[i] ?? i + 1;
    groups.set(g, [...(groups.get(g) ?? []), f]);
  });
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
}

export function GalleryDialog({
  files,
  kind,
  onChoose,
  onCancel,
}: {
  files: File[] | null;
  kind: CaptureKind;
  /** Kelompok file: setiap elemen menjadi satu capture. */
  onChoose: (groups: File[][]) => void;
  onCancel: () => void;
}) {
  const [manual, setManual] = useState<number[] | null>(null);
  const n = files?.length ?? 0;
  const shot = kind === 'marketplace';
  const close = () => {
    setManual(null);
    onCancel();
  };
  const choose = (g: File[][]) => {
    setManual(null);
    onChoose(g);
  };
  return (
    <Dialog open={n > 1} onOpenChange={(v) => (v ? undefined : close())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <div className="flex flex-col gap-4">
          <DialogTitle>{fill(CAMERA_COPY.galleryTitle, { n })}</DialogTitle>
          {manual === null ? (
            <>
              <DialogDescription>
                {fill(shot ? CAMERA_COPY.galleryQuestionScreenshot : CAMERA_COPY.galleryQuestionReceipt, { n })}
              </DialogDescription>
              <div className="flex flex-col gap-2">
                <Button size="action" onClick={() => choose(files!.map((f) => [f]))}>
                  {fill(shot ? CAMERA_COPY.galleryDistinctScreenshot : CAMERA_COPY.galleryDistinctReceipt, { n })}
                </Button>
                <Button size="action" variant="secondary" onClick={() => choose([files!])}>
                  {shot ? CAMERA_COPY.gallerySingleScreenshot : CAMERA_COPY.gallerySingleReceipt}
                </Button>
                <Button size="action" variant="ghost" onClick={() => setManual(files!.map((_, i) => i + 1))}>
                  {CAMERA_COPY.galleryManual}
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogDescription>{CAMERA_COPY.galleryManualHint}</DialogDescription>
              <ol className="flex flex-col gap-2">
                {files!.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-3">
                    <Thumb file={f} alt={fill(CAMERA_COPY.imageAlt, { n: i + 1 })} />
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      <span>{fill(CAMERA_COPY.galleryGroupLabel, { n: i + 1 })}</span>
                      <select
                        className="h-touch rounded-lg border border-border bg-surface px-2 text-base"
                        value={manual[i]}
                        onChange={(e) => setManual(manual.map((g, j) => (j === i ? Number(e.target.value) : g)))}
                      >
                        {files!.map((_, g) => (
                          <option key={g} value={g + 1}>
                            {fill(CAMERA_COPY.galleryGroupOption, { n: g + 1 })}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ol>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={close}>
                  {CAMERA_COPY.galleryCancel}
                </Button>
                <Button className="flex-1" onClick={() => choose(groupFiles(files!, manual))}>
                  {CAMERA_COPY.gallerySave}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Thumb({ file, alt }: { file: File; alt: string }) {
  const [url] = useState(() => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : ''));
  return (
    // eslint-disable-next-line @next/next/no-img-element -- blob: lokal, bukan aset Next
    <img src={url || undefined} alt={alt} className="size-14 shrink-0 rounded-md bg-muted object-cover" />
  );
}
