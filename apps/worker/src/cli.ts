// Argumen baris perintah worker (docs/06 §2.4, docs/09 §3.3, Tahap 7b B2).
//   [--dev-scheduler] [--once [--sweep]] [--worker-id <id>]
// Argumen yang tidak dikenal atau kombinasi yang tidak valid ditolak sebelum koneksi apa pun dibuat,
// supaya salah ketik di workflow produksi gagal jelas, bukan diam-diam berjalan dengan mode lain.
export interface WorkerArgs {
  once: boolean;
  /** Sapuan unggahan yatim setelah antrean kosong. Hanya bersama --once (F-185). */
  sweep: boolean;
  devScheduler: boolean;
  workerId: string | null;
}

export function parseWorkerArgs(argv: readonly string[]): WorkerArgs {
  const out: WorkerArgs = { once: false, sweep: false, devScheduler: false, workerId: null };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (seen.has(a)) throw new Error(`argumen ganda: ${a}`);
    seen.add(a);
    switch (a) {
      case '--once':
        out.once = true;
        break;
      case '--sweep':
        out.sweep = true;
        break;
      case '--dev-scheduler':
        out.devScheduler = true;
        break;
      case '--worker-id': {
        const v = argv[i + 1];
        if (!v || v.startsWith('--')) throw new Error('--worker-id butuh nilai');
        out.workerId = v;
        i++;
        break;
      }
      default:
        throw new Error(`argumen tidak dikenal: ${a}`);
    }
  }
  if (out.sweep && !out.once) throw new Error('--sweep hanya bersama --once');
  if (out.devScheduler && out.once) throw new Error('--dev-scheduler tidak bisa bersama --once');
  return out;
}
