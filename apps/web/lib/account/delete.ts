// Hapus akun (docs/05 §7.6, BR-8). Logika dipisah dari Route Handler supaya bisa diuji
// tanpa Next.js. Setiap langkah aman diulang:
//   1. Verifikasi sesi: login ulang ≤ 15 menit + teks konfirmasi, jika tidak → REAUTH_REQUIRED.
//   2. begin_account_deletion (satu transaksi, idempoten): arsipkan household + job delete_household.
//   3. auth.admin.deleteUser → cascade profile + membership.
//   4. 202. Klien lalu signOut. Job delete_household (worker) menghapus file dan data.
import { ACCOUNT_DELETE_CONFIRMATION, ACCOUNT_DELETE_REAUTH_MINUTES } from '@priceatlas/contracts';

export interface SessionUser {
  id: string;
  last_sign_in_at?: string | null;
}

export interface DeleteAccountDeps {
  getUser(): Promise<SessionUser | null>;
  beginDeletion(userId: string): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
}

export interface RouteResult {
  status: number;
  body: { status?: string; error?: string; message: string };
}

export async function deleteAccount(deps: DeleteAccountDeps, body: unknown, now = new Date()): Promise<RouteResult> {
  const user = await deps.getUser();
  const signedIn = user?.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
  const recent = now.getTime() - signedIn <= ACCOUNT_DELETE_REAUTH_MINUTES * 60_000;
  const confirmed = (body as { confirm?: unknown } | null)?.confirm === ACCOUNT_DELETE_CONFIRMATION;
  if (!user || !recent || !confirmed) {
    return {
      status: 401,
      body: { error: 'REAUTH_REQUIRED', message: 'Masuk ulang dulu dan ketik konfirmasi untuk menghapus akun.' },
    };
  }

  try {
    await deps.beginDeletion(user.id);
  } catch {
    return {
      status: 500,
      body: { error: 'DELETE_FAILED', message: 'Gagal memulai penghapusan akun. Tidak ada yang berubah; coba lagi.' },
    };
  }
  try {
    await deps.deleteAuthUser(user.id);
  } catch {
    // Household sudah diarsipkan dan job sudah antre; mengulang endpoint aman (langkah 2 idempoten).
    return { status: 500, body: { error: 'DELETE_INCOMPLETE', message: 'Penghapusan belum selesai. Coba lagi.' } };
  }
  return {
    status: 202,
    body: { status: 'accepted', message: 'Akun dihapus. Data dihapus bertahap di latar belakang.' },
  };
}
