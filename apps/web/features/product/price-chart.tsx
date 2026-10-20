'use client';
// Grafik harga per satuan S-03 (D-80/Q-59: SVG sendiri, tanpa pustaka grafik). Titik per record
// (sumbu x = tanggal transaksi), garis putus-putus = termurah 90 hari. Bentuk titik berbeda per label
// (bukan hanya warna, U-15) + tabel alternatif untuk pembaca layar (§10.1).
import type { ChartPoint, ProductCard } from '@priceatlas/contracts';
import { basisText } from '@/components/price/price';
import { fill, PRODUCT_COPY } from '@/lib/copy/id';
import { daysBetween, formatDateAbsolute, formatUnitPrice } from '@/lib/format';
import { displayUnitPrice } from '@/lib/format/unit';

const W = 320;
const H = 160;
const PAD = { top: 12, right: 12, bottom: 24, left: 56 };

export interface ChartGeometry {
  points: { x: number; y: number; p: ChartPoint }[];
  bestY: number | null;
  min: number;
  max: number;
}

/** Skala linear; tanggal dibandingkan sebagai hari kalender (tanpa zona waktu, §10.3). */
export function chartGeometry(points: readonly ChartPoint[], best: number | null): ChartGeometry {
  const values = points.map((p) => p.unit_price).concat(best != null ? [best] : []);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min = min * 0.95;
    max = max * 1.05 || 1;
  }
  const first = points[0]!.date;
  const span = Math.max(1, daysBetween(points[points.length - 1]!.date, first));
  const x = (d: string) =>
    points.length === 1
      ? (PAD.left + W - PAD.right) / 2
      : PAD.left + (daysBetween(d, first) / span) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
  return {
    points: points.map((p) => ({ x: x(p.date), y: y(p.unit_price), p })),
    bestY: best != null ? y(best) : null,
    min,
    max,
  };
}

function Marker({ x, y, basis }: { x: number; y: number; basis: ChartPoint['price_basis'] }) {
  if (basis === 'promo') return <rect x={x - 4} y={y - 4} width={8} height={8} className="fill-success" />;
  if (basis === 'member')
    return <path d={`M${x} ${y - 5} L${x + 5} ${y + 4} L${x - 5} ${y + 4} Z`} className="fill-primary" />;
  return <circle cx={x} cy={y} r={4} className="fill-foreground" />;
}

export function PriceChart({
  points,
  product,
  best90,
  normalOnly,
}: {
  points: readonly ChartPoint[];
  product: ProductCard['product'];
  best90: number | null;
  normalOnly: boolean;
}) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {normalOnly ? PRODUCT_COPY.chartEmptyNormal : PRODUCT_COPY.chartEmpty}
      </p>
    );
  }
  const fmt = (v: number) => {
    const d = displayUnitPrice(product, v);
    return formatUnitPrice(d.value, d.unit);
  };
  const g = chartGeometry(points, normalOnly ? null : best90);
  const summary = fill(PRODUCT_COPY.chartSpoken, {
    n: points.length,
    from: formatDateAbsolute(points[0]!.date),
    to: formatDateAbsolute(points[points.length - 1]!.date),
    min: fmt(Math.min(...points.map((p) => p.unit_price))),
    max: fmt(Math.max(...points.map((p) => p.unit_price))),
  });
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        className="w-full text-xs"
        data-testid="price-chart"
      >
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="stroke-divider" />
        <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" className="fill-muted-foreground">
          {fmt(g.max)}
        </text>
        <text x={PAD.left - 4} y={H - PAD.bottom} textAnchor="end" className="fill-muted-foreground">
          {fmt(g.min)}
        </text>
        <text x={PAD.left} y={H - 6} className="fill-muted-foreground">
          {formatDateAbsolute(points[0]!.date)}
        </text>
        {points.length > 1 ? (
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-muted-foreground">
            {formatDateAbsolute(points[points.length - 1]!.date)}
          </text>
        ) : null}
        {g.bestY != null ? (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={g.bestY}
            y2={g.bestY}
            strokeDasharray="4 4"
            className="stroke-success"
          />
        ) : null}
        <polyline
          points={g.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth={1}
        />
        {g.points.map((p) => (
          <Marker key={p.p.record_id} x={p.x} y={p.y} basis={p.p.price_basis} />
        ))}
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        ● {basisText('normal')} · ■ {basisText('promo')} · ▲ {basisText('member')}
        {g.bestY != null ? ` · ${PRODUCT_COPY.chartBestLine}` : ''}
      </figcaption>
      <details className="text-sm">
        <summary className="flex min-h-touch cursor-pointer items-center font-medium">
          {PRODUCT_COPY.chartTable}
        </summary>
        <table className="w-full text-left">
          <caption className="sr-only">{PRODUCT_COPY.chartTableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{PRODUCT_COPY.colDate}</th>
              <th scope="col">{PRODUCT_COPY.colUnit}</th>
              <th scope="col">{PRODUCT_COPY.colLabel}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.record_id}>
                <td>{formatDateAbsolute(p.date)}</td>
                <td className="tabular-nums">{fmt(p.unit_price)}</td>
                <td>{basisText(p.price_basis)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
