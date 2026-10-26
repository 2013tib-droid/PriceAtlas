// @vitest-environment jsdom
// L5b komponen M0: S-00a (semua langkah + keadaan error), TabBar, OfflineStrip.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_COPY, APP_COPY, fill } from '@/lib/copy/id';
import { createQueryClient } from '@/lib/data/query-client';

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/', search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.replace }),
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
}));

const ID = '00000000-0000-0000-0000-00000000000a';
const CONTEXT = {
  user_id: ID,
  display_name: 'Ani',
  household: {
    id: ID,
    name: 'Rumah Ani',
    default_currency: 'IDR',
    timezone: 'Asia/Jakarta',
    share_prices_public: false,
  },
  role: 'owner',
  program_ids: [],
};
const sb = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
  },
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({ getSupabaseBrowserClient: () => sb }));

const { SignInScreen } = await import('@/features/auth/sign-in-screen');
const { AuthProvider } = await import('@/lib/auth/session');
const { TabBar } = await import('@/components/app/tab-bar');
const { OfflineStrip } = await import('@/components/app/offline-strip');

function wrap(ui: ReactNode) {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/';
  nav.search = new URLSearchParams();
  sb.auth.getSession.mockResolvedValue({ data: { session: null } });
  sb.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  sb.auth.signInWithOtp.mockResolvedValue({ error: null });
  sb.auth.verifyOtp.mockResolvedValue({ error: null });
  sb.rpc.mockResolvedValue({ data: CONTEXT, error: null });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('S-00a Masuk', () => {
  it('email → kode 6 digit → R1 get_my_context → tujuan ?next', async () => {
    nav.search = new URLSearchParams('next=/unggahan');
    const user = userEvent.setup();
    wrap(<SignInScreen />);

    expect(screen.getByRole('heading', { name: AUTH_COPY.title })).toBeTruthy();
    await user.type(screen.getByLabelText(AUTH_COPY.emailLabel), 'ani@example.com');
    await user.click(screen.getByRole('button', { name: AUTH_COPY.sendCode }));

    expect(sb.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ani@example.com',
      options: { shouldCreateUser: true },
    });
    expect(await screen.findByRole('heading', { name: AUTH_COPY.codeTitle })).toBeTruthy();
    expect(screen.getByText(fill(AUTH_COPY.codeSentTo, { email: 'ani@example.com' }))).toBeTruthy();

    const code = screen.getByLabelText(AUTH_COPY.codeLabel);
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(code.getAttribute('inputmode')).toBe('numeric');
    await waitFor(() => expect(document.activeElement).toBe(code));
    await user.type(code, '12a3456');
    expect((code as HTMLInputElement).value).toBe('123456');
    await user.click(screen.getByRole('button', { name: AUTH_COPY.verify }));

    expect(sb.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ani@example.com', token: '123456', type: 'email' });
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('get_my_context', {}));
    // Semua login lewat S-00b (yang meneruskan ke ?next jika sudah onboarded, M6).
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/selamat-datang?next=%2Funggahan'));
  });

  it('email tidak valid tidak dikirim', async () => {
    const user = userEvent.setup();
    wrap(<SignInScreen />);
    await user.type(screen.getByLabelText(AUTH_COPY.emailLabel), 'bukan-email');
    await user.click(screen.getByRole('button', { name: AUTH_COPY.sendCode }));
    expect(screen.getByRole('alert').textContent).toBe(AUTH_COPY.emailInvalid);
    expect(sb.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('kode salah dan rate limit ditampilkan sebagai teks (role=alert)', async () => {
    const user = userEvent.setup();
    wrap(<SignInScreen />);
    await user.type(screen.getByLabelText(AUTH_COPY.emailLabel), 'ani@example.com');
    await user.click(screen.getByRole('button', { name: AUTH_COPY.sendCode }));
    sb.auth.verifyOtp.mockResolvedValueOnce({
      error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' },
    });
    await user.type(await screen.findByLabelText(AUTH_COPY.codeLabel), '000000');
    await user.click(screen.getByRole('button', { name: AUTH_COPY.verify }));
    expect(await screen.findByText(AUTH_COPY.codeWrong)).toBeTruthy();
    expect(sb.rpc).not.toHaveBeenCalled();
    // Kirim ulang dikunci 60 dtk.
    expect((screen.getByRole('button', { name: /Kirim ulang dalam/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('rate limit saat kirim kode', async () => {
    sb.auth.signInWithOtp.mockResolvedValueOnce({
      error: { code: 'over_email_send_rate_limit', status: 429, message: 'x' },
    });
    const user = userEvent.setup();
    wrap(<SignInScreen />);
    await user.type(screen.getByLabelText(AUTH_COPY.emailLabel), 'ani@example.com');
    await user.click(screen.getByRole('button', { name: AUTH_COPY.sendCode }));
    expect(await screen.findByText(AUTH_COPY.rateLimited)).toBeTruthy();
    expect(screen.getByRole('heading', { name: AUTH_COPY.title })).toBeTruthy();
  });

  it('offline: pesan butuh sinyal dan tombol nonaktif', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    wrap(<SignInScreen />);
    expect(screen.getByRole('alert').textContent).toBe(AUTH_COPY.offline);
    expect((screen.getByRole('button', { name: AUTH_COPY.sendCode }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Google memakai PKCE ke /auth/callback dengan next', async () => {
    nav.search = new URLSearchParams('next=/saya');
    sb.auth.signInWithOAuth.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    wrap(<SignInScreen />);
    await user.click(screen.getByRole('button', { name: AUTH_COPY.google }));
    expect(sb.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=%2Fselamat-datang%3Fnext%3D%252Fsaya` },
    });
  });

  it('kembali dari callback gagal menampilkan pesan', () => {
    nav.search = new URLSearchParams('error=callback');
    wrap(<SignInScreen />);
    expect(screen.getByRole('alert').textContent).toBe(AUTH_COPY.callbackFailed);
  });
});

describe('TabBar', () => {
  it('4 tab + tombol kamera di tengah, tab aktif ditandai', () => {
    nav.pathname = '/unggahan';
    wrap(<TabBar />);
    const navEl = screen.getByRole('navigation', { name: 'Navigasi utama' });
    const items = within(navEl).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(within(items[2]!).getByRole('button', { name: APP_COPY.cameraLabel })).toBeTruthy();
    const links = within(navEl).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Cari', 'Unggahan', 'Belanja', 'Saya']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/', '/unggahan', '/belanja', '/saya']);
    expect(screen.getByRole('link', { name: 'Unggahan' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Cari' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('OfflineStrip', () => {
  it('muncul saat offline dan hilang saat online', async () => {
    render(<OfflineStrip />);
    expect(screen.queryByText(APP_COPY.offlineStrip)).toBeNull();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(await screen.findByText(APP_COPY.offlineStrip)).toBeTruthy();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => void window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(screen.queryByText(APP_COPY.offlineStrip)).toBeNull());
  });
});
