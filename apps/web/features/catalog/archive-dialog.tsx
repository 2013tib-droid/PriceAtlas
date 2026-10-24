'use client';
// Hapus (arsipkan) produk privat dari menu ⋯ S-03 dan S-15 edit (docs/05 §3.3 S-03): REST
// `PATCH product?id=eq.X&updated_at=eq.T {status: 'archived'}`. Record tetap ada dan tetap terlihat di
// histori. 0 baris = STALE_WRITE → baris produk dimuat ulang, user menekan lagi.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { productEditError } from '@/lib/catalog/errors';
import { CATALOG_COPY, fill } from '@/lib/copy/id';
import { usePatchProduct, useProductRow } from '@/lib/data/catalog';
import { flashToast } from '@/lib/flash';

const E = CATALOG_COPY.edit;

export function ArchiveDialog({
  productId,
  name,
  open,
  onOpenChange,
}: {
  productId: string;
  name: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const row = useProductRow(open ? productId : null);
  const patch = usePatchProduct();
  const [error, setError] = useState<string | null>(null);
  const archive = () => {
    if (!row.data) return;
    setError(null);
    patch.mutate(
      { id: productId, updatedAt: row.data.updated_at, patch: { status: 'archived' } },
      {
        onSuccess: () => {
          onOpenChange(false);
          flashToast('success', fill(E.archived, { name }));
          router.replace('/');
        },
        onError: (e) => {
          const r = productEditError(e);
          setError(r.message);
          if (r.stale) void row.refetch();
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex flex-col gap-4">
          <DialogTitle>{E.archiveTitle}</DialogTitle>
          <DialogDescription>{E.archiveBody}</DialogDescription>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
              {E.cancel}
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={archive}
              disabled={!row.data || patch.isPending}
              data-testid="archive-confirm"
            >
              {E.archiveConfirm}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
