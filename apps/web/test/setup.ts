// Setup bersama. Di jsdom: matcher DOM sederhana tidak dipakai; test memakai Testing Library.
import { afterEach } from 'vitest';

afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
