'use client';
// S-06 Pilih jenis foto (kerangka M0). Kamera, galeri, dan antrean dibuat di M2.
import { Images, ReceiptText, Smartphone, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { APP_COPY } from '@/lib/copy/id';

export function PhotoSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const o = APP_COPY.photoOptions;
  const options = [
    { label: o.receipt, icon: ReceiptText },
    { label: o.label, icon: Tag },
    { label: o.screenshot, icon: Smartphone },
    { label: o.gallery, icon: Images },
  ];
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="flex flex-col gap-3 p-4">
          <DrawerTitle>{APP_COPY.photoSheetTitle}</DrawerTitle>
          <DrawerDescription>{APP_COPY.photoSheetSoon}</DrawerDescription>
          <ul className="flex flex-col gap-2">
            {options.map(({ label, icon: Icon }) => (
              <li key={label}>
                <Button variant="secondary" size="action" disabled className="justify-start">
                  <Icon aria-hidden />
                  {label}
                  <span className="ml-auto text-sm text-muted-foreground">{APP_COPY.comingSoon}</span>
                </Button>
              </li>
            ))}
          </ul>
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
