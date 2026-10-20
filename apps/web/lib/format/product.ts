import { formatSize, type SizedProduct } from './money';

const norm = (s: string) => s.toLowerCase().replace(/[x×]/g, 'x').replace(/\s+/g, '');

/**
 * Nama tampilan + ukuran. Varian yang isinya sama dengan ukuran (mis. variant "200 g") tidak
 * diulang di judul.
 */
export function productTitle(p: SizedProduct & { name: string; variant: string | null }): {
  title: string;
  size: string;
} {
  const size = formatSize(p);
  const variant = p.variant && norm(p.variant) !== norm(size) ? ` ${p.variant}` : '';
  return { title: `${p.name}${variant}`, size };
}
