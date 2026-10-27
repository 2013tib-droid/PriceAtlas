// Template HTML untuk gambar sintetis (docs/08 §13.1, F-118, Q-72): struk thermal, label rak, dan
// screenshot belanja online. Semua isi buatan; tidak ada logo/merek dagang selain nama teks yang
// sudah dipakai fixture. Dirender ke JPEG oleh generate.ts lewat Playwright.

export interface Look {
  /** Rotasi kecil dokumen (derajat), meniru foto miring. */
  rotateDeg?: number;
  /** Jumlah bintik derau (deterministik dari `seed`). */
  noise?: number;
  seed?: number;
  /** Blur CSS (px): fixture "buram". */
  blurPx?: number;
  /** Kontras tinta 0–1 (thermal pudar < 1). */
  ink?: number;
}

export interface ReceiptRow {
  text: string;
  qty?: string;
  amount?: string;
  indent?: boolean;
  bold?: boolean;
  center?: boolean;
}

export interface ReceiptDoc {
  header: string[];
  rows: ReceiptRow[];
  footer: string[];
}

export interface LabelDoc {
  name: string;
  barcode?: string;
  price: string;
  promo?: { price: string; until: string };
  member?: { price: string; program: string };
}

export interface ListingDoc {
  marketplace: string;
  title: string;
  price: string;
  strikePrice?: string;
  seller: string;
  shipping: string;
  urlText?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Bintik derau deterministik (mulberry32) di atas dokumen. */
function noiseScript(look: Look): string {
  if (!look.noise) return '';
  return `<script>
  (() => {
    let a = ${look.seed ?? 1} >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const doc = document.getElementById('doc');
    const c = document.createElement('canvas');
    c.width = doc.offsetWidth; c.height = doc.offsetHeight;
    c.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    const g = c.getContext('2d');
    for (let i = 0; i < ${look.noise}; i++) {
      g.fillStyle = 'rgba(60,60,60,' + (0.15 + rnd() * 0.35).toFixed(2) + ')';
      g.fillRect(rnd() * c.width, rnd() * c.height, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    doc.appendChild(c);
  })();
  </script>`;
}

function page(body: string, look: Look, docCss: string, bg: string): string {
  const filter = [look.blurPx ? `blur(${look.blurPx}px)` : '', look.ink != null ? `contrast(${look.ink})` : ''].join(' ').trim();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:${bg}}
  #wrap{display:inline-block;padding:28px}
  #doc{position:relative;${docCss};transform:rotate(${look.rotateDeg ?? 0}deg);${filter ? `filter:${filter};` : ''}}
  </style></head><body><div id="wrap"><div id="doc">${body}</div></div>${noiseScript(look)}</body></html>`;
}

export function receiptHtml(doc: ReceiptDoc, look: Look = {}): string {
  const row = (r: ReceiptRow) => {
    if (r.center) return `<div class="c${r.bold ? ' b' : ''}">${esc(r.text)}</div>`;
    return `<div class="r${r.bold ? ' b' : ''}"><span class="t">${r.indent ? '&nbsp;&nbsp;' : ''}${esc(r.text)}</span><span class="q">${esc(r.qty ?? '')}</span><span class="a">${esc(r.amount ?? '')}</span></div>`;
  };
  const body = `<style>
    .c{text-align:center}.b{font-weight:bold}
    .r{display:flex;white-space:pre}.t{flex:1}.q{width:120px;text-align:right}.a{width:90px;text-align:right}
    hr{border:0;border-top:1px dashed #333;margin:6px 0}
  </style>
  ${doc.header.map((h, i) => `<div class="c${i === 0 ? ' b' : ''}">${esc(h)}</div>`).join('')}
  <hr>${doc.rows.map(row).join('')}<hr>
  ${doc.footer.map((f) => `<div class="c">${esc(f)}</div>`).join('')}`;
  return page(
    body,
    look,
    'width:400px;padding:22px 18px;background:#fbfaf6;color:#1d1d1d;font:15px/1.45 "DejaVu Sans Mono",monospace;box-shadow:0 2px 8px rgba(0,0,0,.25)',
    '#6f6a63',
  );
}

export function labelHtml(labels: LabelDoc[], look: Look = {}): string {
  const one = (l: LabelDoc) => `<div class="lbl">
    <div class="n">${esc(l.name)}</div>
    ${l.barcode ? `<div class="bc">${esc(l.barcode)}</div>` : ''}
    ${l.promo ? `<div class="old">${esc(l.price)}</div><div class="promo">PROMO <b>${esc(l.promo.price)}</b></div><div class="until">${esc(l.promo.until)}</div>` : `<div class="p">${esc(l.price)}</div>`}
    ${l.member ? `<div class="mem">${esc(l.member.program)}<br><b>MEMBER ${esc(l.member.price)}</b></div>` : ''}
  </div>`;
  const body = `<style>
    .row{display:flex;gap:26px}
    .lbl{width:300px;min-height:230px;background:#fff;border-top:14px solid #d62b2b;padding:14px 16px;box-sizing:border-box;font-family:"DejaVu Sans",sans-serif;color:#111}
    .n{font-weight:bold;font-size:20px}.bc{font:12px "DejaVu Sans Mono",monospace;color:#444;margin-top:4px}
    .p{font-size:40px;font-weight:bold;margin-top:18px}
    .old{font-size:20px;text-decoration:line-through;color:#555;margin-top:12px}
    .promo{font-size:34px;color:#c21b1b;margin-top:2px}.until{font-size:14px;color:#333}
    .mem{margin-top:10px;background:#123f8c;color:#fff;padding:6px 8px;font-size:16px}
  </style><div class="row">${labels.map(one).join('')}</div>`;
  return page(body, look, 'padding:24px;background:#cfc8bb', '#8a8378');
}

export function listingHtml(d: ListingDoc, look: Look = {}): string {
  const body = `<style>
    .bar{background:#ee4d2d;color:#fff;padding:14px 16px;font:bold 18px "DejaVu Sans",sans-serif}
    .img{height:300px;background:linear-gradient(135deg,#5b3a1e,#a8743f);display:flex;align-items:center;justify-content:center;color:#fff;font:bold 30px "DejaVu Sans",sans-serif}
    .sec{padding:12px 16px;border-bottom:8px solid #f2f2f2;font:15px/1.4 "DejaVu Sans",sans-serif;color:#222}
    .price{color:#ee4d2d;font-size:26px;font-weight:bold}.strike{text-decoration:line-through;color:#999;font-size:14px;margin-left:8px}
    .muted{color:#777;font-size:13px}
  </style>
  <div class="bar">${esc(d.marketplace)}</div>
  <div class="img">MILO</div>
  <div class="sec"><div>${esc(d.title)}</div><div><span class="price">${esc(d.price)}</span>${d.strikePrice ? `<span class="strike">${esc(d.strikePrice)}</span>` : ''}</div></div>
  <div class="sec">Pengiriman<br><span class="muted">Ongkir ${esc(d.shipping)}</span></div>
  <div class="sec"><b>${esc(d.seller)}</b><br><span class="muted">Toko resmi · Aktif 5 menit lalu</span></div>
  ${d.urlText ? `<div class="sec muted">${esc(d.urlText)}</div>` : ''}`;
  return page(body, look, 'width:390px;min-height:844px;background:#fff', '#ffffff');
}
