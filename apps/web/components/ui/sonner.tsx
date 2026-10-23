'use client';
// Toast (sonner, aria-live) di atas tab bar supaya tidak menutupi aksi utama (U-11).
import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={{ bottom: 'calc(var(--bottom-bars) + 0.75rem)' }}
      mobileOffset={{ bottom: 'calc(var(--bottom-bars) + 0.75rem)' }}
      toastOptions={{ classNames: { toast: 'text-base' } }}
    />
  );
}
