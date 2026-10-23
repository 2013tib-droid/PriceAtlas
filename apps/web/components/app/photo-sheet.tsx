'use client';
// S-06 Pilih jenis foto (wireframe S-06, U-08): sheet global lewat `?sheet=foto` sehingga tombol
// kembali Android menutup sheet (docs/07 §3.3). Tanpa sesi belanja: Struk, Label, Screenshot, lalu
// "Pilih dari galeri"; sesi aktif (R18): Label paling atas dan terpilih + "Label harga akan masuk ke
// AEON BSD". Struk/galeri/screenshot langsung membuka kamera bawaan atau galeri (satu ketukan); file
// diserahkan ke S-07 lewat handoff di memori. Label → kamera label (sesi) atau S-12 mode manual (F-53).
import { Images, ReceiptText, Smartphone, Tag } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useId, type ChangeEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { APP_COPY, fill } from '@/lib/copy/id';
import { useActiveSession } from '@/lib/data/session';
import { useNow } from '@/lib/hooks/use-now';
import { setPendingFiles, type PendingFiles } from '@/lib/media/handoff';
import { LABEL_CAMERA, labelLocationHref } from '@/lib/session/label-target';
import { activeOrNull, photoOptionOrder, sessionPlace, type PhotoOption } from '@/lib/session/session';
import { cn } from '@/lib/utils';

export const SHEET_PHOTO = 'foto';

// Sheet yang dibuka lewat push ditutup dengan back (tidak menumpuk riwayat); dari tautan langsung
// (?sheet=foto di URL) ditutup dengan replace.
let pushed = false;

/** Buka/tutup sheet foto lewat query `?sheet=foto` di route saat ini. */
export function usePhotoSheet() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const isOpen = params?.get('sheet') === SHEET_PHOTO;
  const withoutSheet = useCallback(() => {
    const qs = new URLSearchParams(params?.toString());
    qs.delete('sheet');
    const s = qs.toString();
    return s ? `${pathname}?${s}` : pathname;
  }, [params, pathname]);
  const open = useCallback(() => {
    const qs = new URLSearchParams(params?.toString());
    qs.set('sheet', SHEET_PHOTO);
    pushed = true;
    router.push(`${pathname}?${qs.toString()}`, { scroll: false });
  }, [params, pathname, router]);
  const close = useCallback(() => {
    if (pushed) {
      pushed = false;
      router.back();
    } else router.replace(withoutSheet(), { scroll: false });
  }, [router, withoutSheet]);
  return { isOpen, open, close };
}

const optionClass =
  'flex min-h-action w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 text-left has-focus-visible:outline-2 has-focus-visible:outline-focus';

function OptionText({ title, hint }: { title: string; hint?: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-base font-medium">{title}</span>
      {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
    </span>
  );
}

/** Pilihan yang membuka kamera bawaan / galeri: <label> + <input type=file> (aktivasi asli). */
function FileOption({
  icon,
  title,
  hint,
  capture,
  multiple,
  onFiles,
  testId,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  capture?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  testId: string;
}) {
  const id = useId();
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) onFiles(files);
  };
  return (
    <label htmlFor={id} className={optionClass}>
      {icon}
      <OptionText title={title} hint={hint} />
      <input
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        data-testid={testId}
        {...(capture ? { capture: 'environment' as const } : {})}
        multiple={multiple}
        onChange={onChange}
      />
    </label>
  );
}

export function PhotoSheet() {
  const router = useRouter();
  const { isOpen, close } = usePhotoSheet();
  const session = useActiveSession();
  const now = useNow(30_000);
  const active = activeOrNull(session.data, now);
  const o = APP_COPY.photoOptions;
  const h = APP_COPY.photoOptionHints;

  // Mengganti entri ?sheet=foto, sehingga kembali dari kamera menuju layar di bawahnya.
  const go = (p: PendingFiles, href: string) => {
    setPendingFiles(p);
    pushed = false;
    router.replace(href);
  };
  const label = () => {
    pushed = false;
    router.replace(active ? LABEL_CAMERA : labelLocationHref());
  };

  const options: Record<PhotoOption, ReactNode> = {
    receipt: (
      <FileOption
        icon={<ReceiptText aria-hidden className="size-6 shrink-0" />}
        title={o.receipt}
        hint={h.receipt}
        capture
        testId="sheet-input-receipt"
        onFiles={(files) => go({ kind: 'receipt', source: 'camera', files }, '/kamera?jenis=struk')}
      />
    ),
    label: (
      <button
        type="button"
        className={cn(optionClass, active && 'border-2 border-primary')}
        aria-current={active ? 'true' : undefined}
        onClick={label}
      >
        <Tag aria-hidden className="size-6 shrink-0" />
        <OptionText
          title={o.label}
          hint={active ? fill(APP_COPY.labelTarget, { place: sessionPlace(active) }) : h.label}
        />
      </button>
    ),
    screenshot: (
      <FileOption
        icon={<Smartphone aria-hidden className="size-6 shrink-0" />}
        title={o.screenshot}
        hint={h.screenshot}
        multiple
        testId="sheet-input-screenshot"
        onFiles={(files) => go({ kind: 'marketplace', source: 'gallery', files }, '/kamera?jenis=screenshot')}
      />
    ),
  };

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DrawerContent>
        <div className="flex flex-col gap-3 p-4">
          <DrawerTitle>{APP_COPY.photoSheetTitle}</DrawerTitle>
          <DrawerDescription>{APP_COPY.photoSheetDescription}</DrawerDescription>
          <ul className="flex flex-col gap-2">
            {photoOptionOrder(Boolean(active)).map((k) => (
              <li key={k}>{options[k]}</li>
            ))}
          </ul>
          <FileOption
            icon={<Images aria-hidden className="size-6 shrink-0" />}
            title={o.gallery}
            multiple
            testId="sheet-input-gallery"
            onFiles={(files) => go({ kind: 'receipt', source: 'gallery', files }, '/kamera?jenis=struk&sumber=galeri')}
          />
          <DrawerClose asChild>
            <Button variant="ghost" size="action">
              {APP_COPY.close}
            </Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
