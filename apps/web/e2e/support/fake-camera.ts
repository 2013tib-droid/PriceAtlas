// Kamera palsu Chromium untuk e2e kamera label (docs/07 §11.3 alur 4, F-38):
// `--use-file-for-fake-video-capture=<file.y4m>` memutar file Y4M ini sebagai kamera. Dibangkitkan saat
// konfigurasi dimuat (sisi test saja, tidak di-commit sebagai biner): satu frame 1280×720 YUV 4:2:0,
// latar putih dengan blok gelap menyerupai teks label harga. WebKit tidak punya kamera palsu.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FAKE_CAMERA_SIZE = { width: 1280, height: 720 } as const;

export function writeFakeCameraFile(dir = join(tmpdir(), 'priceatlas-e2e')): string {
  const { width: w, height: h } = FAKE_CAMERA_SIZE;
  const y = Buffer.alloc(w * h, 235);
  // "Teks": baris blok gelap (nama produk, harga besar, harga promo).
  const block = (x0: number, y0: number, bw: number, bh: number) => {
    for (let yy = y0; yy < y0 + bh; yy++) y.fill(16, yy * w + x0, yy * w + x0 + bw);
  };
  for (let i = 0; i < 18; i++) block(80 + i * 60, 120, 40, 50);
  for (let i = 0; i < 7; i++) block(80 + i * 140, 300, 110, 160);
  for (let i = 0; i < 9; i++) block(80 + i * 70, 560, 50, 60);
  const chroma = Buffer.alloc((w / 2) * (h / 2), 128);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'label-camera.y4m');
  writeFileSync(
    file,
    Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\nFRAME\n`), y, chroma, chroma]),
  );
  return file;
}
