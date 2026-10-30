// Utilitas skor harness (docs/08 §4.7): jarak teks, algoritma Hungaria, persentil, ECE, isotonic (PAV).

/** Normalisasi teks untuk dibandingkan: huruf besar, spasi dirapatkan. */
export function normText(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Character error rate prediksi terhadap kebenaran (setelah normalisasi spasi). */
export function cer(pred: string | null | undefined, truth: string | null | undefined): number {
  const t = normText(truth);
  return levenshtein(normText(pred), t) / Math.max(1, t.length);
}

/** Kemiripan 0–1 (1 − jarak / panjang terpanjang). */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = normText(a);
  const y = normText(b);
  if (!x.length && !y.length) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/**
 * Penugasan biaya minimum (algoritma Hungaria, O(n³)) untuk matriks persegi panjang: baris = prediksi,
 * kolom = kebenaran. Hasil: kolom untuk setiap baris (-1 = tidak dipasangkan).
 */
export function hungarian(cost: number[][]): number[] {
  const rows = cost.length;
  const cols = rows ? cost[0]!.length : 0;
  if (!rows || !cols) return new Array(rows).fill(-1);
  const n = Math.max(rows, cols);
  const BIG = 1e6;
  const a = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i >= 1 && j >= 1 && i <= rows && j <= cols ? cost[i - 1]![j - 1]! : i && j ? BIG : 0)),
  );
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0]![j]! - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array(rows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const i = p[j];
    if (i >= 1 && i <= rows && j <= cols && cost[i - 1]![j - 1]! < BIG) out[i - 1] = j - 1;
  }
  return out;
}

export function percentile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[idx]!;
}

export interface ConfPoint {
  c: number;
  ok: boolean;
}

/** Expected calibration error, 10 rentang (§4.7). */
export function ece(points: ConfPoint[], bins = 10): number | null {
  if (!points.length) return null;
  let sum = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = points.filter((p) => (b === bins - 1 ? p.c >= lo && p.c <= hi : p.c >= lo && p.c < hi));
    if (!inBin.length) continue;
    const conf = inBin.reduce((s, p) => s + p.c, 0) / inBin.length;
    const acc = inBin.filter((p) => p.ok).length / inBin.length;
    sum += (inBin.length / points.length) * Math.abs(conf - acc);
  }
  return sum;
}

/** Presisi dan coverage auto-save pada ambang τ (§4.7, §8.1). */
export function atTau(points: ConfPoint[], tau: number): { precision: number | null; coverage: number | null; n: number } {
  const above = points.filter((p) => p.c >= tau);
  return {
    precision: above.length ? above.filter((p) => p.ok).length / above.length : null,
    coverage: points.length ? above.length / points.length : null,
    n: above.length,
  };
}

/** τ terkecil (grid 0,01) dengan presisi ≥ target; null jika tidak ada. */
export function minTauFor(points: ConfPoint[], target: number): number | null {
  for (let t = 0; t <= 100; t++) {
    const tau = t / 100;
    const r = atTau(points, tau);
    if (r.n > 0 && r.precision !== null && r.precision >= target) return tau;
  }
  return null;
}

/**
 * Isotonic regression (pool-adjacent-violators): confidence → probabilitas benar, monoton naik
 * (§8.1). Hasil: titik tangga [batas bawah confidence, probabilitas].
 */
export function isotonic(points: ConfPoint[]): { from: number; p: number; n: number }[] {
  const s = [...points].sort((x, y) => x.c - y.c);
  const blocks: { from: number; sum: number; n: number }[] = [];
  for (const pt of s) {
    blocks.push({ from: pt.c, sum: pt.ok ? 1 : 0, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { from: a.from, sum: a.sum + b.sum, n: a.n + b.n });
    }
  }
  return blocks.map((b) => ({ from: Math.round(b.from * 1000) / 1000, p: Math.round((b.sum / b.n) * 1000) / 1000, n: b.n }));
}
