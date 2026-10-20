// vi.mock bersama untuk test M1 (diimpor paling atas di setiap file test M1).
import { vi } from 'vitest';

vi.mock('@/lib/supabase/browser', async () => {
  const h = await import('./harness');
  return { getSupabaseBrowserClient: () => h.sb };
});
vi.mock('next/navigation', async () => {
  const h = await import('./harness');
  return {
    useRouter: () => ({ push: h.nav.push, replace: h.nav.replace, back: h.nav.back, prefetch: () => undefined }),
    usePathname: () => h.nav.pathname,
    useSearchParams: () => h.nav.search,
  };
});
vi.mock('sonner', async (orig) => ({ ...(await orig<typeof import('sonner')>()), toast: vi.fn() }));
