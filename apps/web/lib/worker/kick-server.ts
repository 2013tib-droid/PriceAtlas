// POST /api/worker/kick (Tahap 7b B4, docs/09 §3.3, F-191, D-101 Q-152). Logika dipisah dari Route
// Handler supaya bisa diuji tanpa Next.js (pola /api/account/delete, /api/ask). HANYA server: dipakai
// app/api/worker/kick/route.ts (yang mengimpor 'server-only'); GITHUB_DISPATCH_TOKEN tidak pernah
// NEXT_PUBLIC_.
//   1. User dari cookie sesi (getUser, diverifikasi ke server Auth) → tanpa sesi 401
//   2. GITHUB_DISPATCH_TOKEN / GITHUB_DISPATCH_REPO kosong → 204 tanpa aksi (dev, CI, Preview)
//   3. GitHub `workflow_dispatch` worker.yml (ref master), timeout 5 dtk → 202; gagal → 502
// Route ini tidak menulis data (D-61): hanya meneruskan operasi bersecret. Respons tanpa detail error
// GitHub; log hanya status HTTP + durasi (tanpa token, tanpa id user).
export const KICK_WORKFLOW = 'worker.yml';
export const KICK_REF = 'master';
export const KICK_TIMEOUT_MS = 5_000;
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export interface KickConfig {
  token: string;
  repo: string;
}

/** Konfigurasi dari env; null jika belum lengkap atau repo tidak valid (kick = no-op). */
export function kickConfigFromEnv(env: Record<string, string | undefined> = process.env): KickConfig | null {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  const repo = env.GITHUB_DISPATCH_REPO?.trim();
  if (!token || !repo || !REPO_RE.test(repo)) return null;
  return { token, repo };
}

export type KickLogFn = (event: string, fields: Record<string, unknown>) => void;

export interface KickDeps {
  getUser(): Promise<{ id: string } | null>;
  config: KickConfig | null;
  fetch?: typeof fetch;
  log?: KickLogFn;
  timeoutMs?: number;
}

export interface KickResult {
  status: 202 | 204 | 401 | 502;
  body: { status?: 'queued'; error?: string; message?: string } | null;
}

function jsonLog(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

export function dispatchUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/actions/workflows/${KICK_WORKFLOW}/dispatches`;
}

export async function handleKick(deps: KickDeps): Promise<KickResult> {
  const user = await deps.getUser();
  if (!user) return { status: 401, body: { error: 'UNAUTHENTICATED', message: 'Masuk dulu.' } };
  if (!deps.config) return { status: 204, body: null };

  const log = deps.log ?? jsonLog;
  const started = Date.now();
  try {
    const res = await (deps.fetch ?? fetch)(dispatchUrl(deps.config.repo), {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${deps.config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'priceatlas-worker-kick',
      },
      body: JSON.stringify({ ref: KICK_REF }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? KICK_TIMEOUT_MS),
      cache: 'no-store',
    });
    // Isi respons tidak dibaca/diteruskan (bisa memuat pesan GitHub); cukup status.
    await res.body?.cancel().catch(() => undefined);
    log('worker.kick', { status: res.status, ms: Date.now() - started });
    if (res.ok) return { status: 202, body: { status: 'queued' } };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    log('worker.kick', { status: timeout ? 'timeout' : 'network_error', ms: Date.now() - started });
  }
  return { status: 502, body: { error: 'KICK_FAILED', message: 'Pemrosesan akan berjalan pada jadwal berikutnya.' } };
}
