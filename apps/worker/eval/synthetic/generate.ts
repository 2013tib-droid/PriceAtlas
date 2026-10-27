// Generator gambar sintetis (docs/08 §13.1, F-118, Q-72): template HTML → JPEG lewat Playwright yang
// sudah terpasang di lingkungan (jangan `playwright install`). CI tidak menjalankan ini: hasilnya
// di-commit sebagai fixture.
//   pnpm --filter @priceatlas/worker synthetic            # tulis ulang fixture (worker + web)
//   pnpm --filter @priceatlas/worker synthetic --out DIR  # set uji: <nama>.jpg + <nama>.truth.json
//   CHROMIUM_PATH=/opt/pw-browsers/chromium …            # jika versi Playwright ≠ browser terpasang
// Setelah fixture berubah, sha256 berubah: ganti nilai sha256 lama di apps/web/test/fixtures/rpc.json
// dan konstanta sha di apps/web/test/browser/media.browser.test.ts (docs/06 §2.6, F-125).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { SPECS, type SyntheticSpec } from './specs.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');

interface Page {
  setContent(html: string): Promise<void>;
  locator(sel: string): { screenshot(o: { type: 'jpeg'; quality: number }): Promise<Buffer> };
}
interface Browser {
  newPage(o: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<Page>;
  close(): Promise<void>;
}

/** Playwright dari lingkungan (bukan dependensi worker), dimuat saat dijalankan saja. */
function loadChromium(): { launch(o?: { executablePath?: string }): Promise<Browser> } {
  const require = createRequire(import.meta.url);
  for (const id of ['playwright', '@playwright/test']) {
    try {
      return (require(id) as { chromium: { launch(o?: { executablePath?: string }): Promise<Browser> } }).chromium;
    } catch {
      /* coba berikutnya */
    }
  }
  throw new Error('Playwright tidak ditemukan. Jalankan di lingkungan yang sudah memasang Playwright + Chromium.');
}

export async function render(specs: SyntheticSpec[] = SPECS): Promise<Map<string, Buffer>> {
  // CHROMIUM_PATH: biner Chromium jika versi Playwright tidak cocok dengan browser terpasang.
  const browser = await loadChromium().launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const out = new Map<string, Buffer>();
    for (const s of specs) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 1 });
      await page.setContent(s.html);
      out.set(s.name, await page.locator('#wrap').screenshot({ type: 'jpeg', quality: 82 }));
    }
    return out;
  } finally {
    await browser.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const images = await render();
  if (outIdx >= 0) {
    const dir = resolve(argv[outIdx + 1] ?? '.data/ocr-eval-synthetic');
    mkdirSync(dir, { recursive: true });
    for (const s of SPECS) {
      const img = images.get(s.name)!;
      writeFileSync(join(dir, `${s.name}.jpg`), img);
      const fx = JSON.parse(readFileSync(join(ROOT, s.fixtureDir, `${s.name}.json`), 'utf8')) as { output: unknown; failures?: unknown[] };
      const unreadable = s.name === 'struk-buram';
      const truth = { id: s.name, kind: s.kind, images: [`${s.name}.jpg`], conditions: s.conditions, synthetic: true, expected: unreadable ? null : fx.output };
      writeFileSync(join(dir, `${s.name}.truth.json`), `${JSON.stringify(truth, null, 2)}\n`);
    }
    console.log(`${SPECS.length} gambar + truth → ${dir}`);
    return;
  }
  for (const s of SPECS) {
    const path = join(ROOT, s.fixtureDir, `${s.name}.jpg`);
    writeFileSync(path, images.get(s.name)!);
    console.log(`${path} (${images.get(s.name)!.length} byte)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
