'use client';
// S-15 sebagai layar sendiri (`/produk/baru`, docs/07 §7.1). Dari scan barcode yang tidak dikenal
// (D-85): `?barcode=…&pilih=produk&untuk=barcode` → S-14 dengan kode terisi dulu (cari produk yang
// mungkin sudah ada), lalu "+ Buat produk baru" → form dengan barcode terisi. Produk dibuat →
// detail S-03. Edit produk (`/produk/edit`) = M5.
import { useRouter } from 'next/navigation';
import { productHref } from '@/components/product/product-card';
import { ProductPicker, PICKER_KEYS } from '@/features/picker/product-picker';
import { fill, NEW_PRODUCT_COPY } from '@/lib/copy/id';
import { flashToast } from '@/lib/flash';
import { productTitle } from '@/lib/format/product';
import { useLayer } from '@/lib/hooks/use-layer';
import { NewProductForm } from './new-product-form';

export function NewProductScreen() {
  const router = useRouter();
  const layer = useLayer();
  const params = layer.params;
  const barcode = params?.get('barcode')?.replace(/\D/g, '') || undefined;
  const name = params?.get('nama') ?? '';
  const pickerOpen = params?.get('pilih') === 'produk';
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-8">
      <NewProductForm
        asScreen
        initialName={name}
        initialBarcode={barcode}
        onCreated={(card) => {
          flashToast('success', fill(NEW_PRODUCT_COPY.created, { name: productTitle(card.product).title }));
          router.replace(productHref(card.product.id));
        }}
      />
      <ProductPicker
        open={pickerOpen}
        onClose={() => layer.close(PICKER_KEYS)}
        initialQuery=""
        barcode={barcode}
        onPick={(p) => router.replace(productHref(p.id))}
        createOpen={false}
        onCreateOpen={() => layer.close(PICKER_KEYS)}
        onCreateClose={() => undefined}
      />
    </section>
  );
}
