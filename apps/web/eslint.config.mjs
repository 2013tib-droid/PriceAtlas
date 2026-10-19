// D-80: ESLint flat config + jsx-a11y + Prettier (format dicek terpisah: pnpm format:check).
// `next lint` tidak ada lagi di Next 16, jadi ESLint dijalankan langsung.
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';

const config = [
  ...nextVitals,
  ...nextTs,
  // Plugin jsx-a11y sudah didaftarkan eslint-config-next; di sini aturan "recommended" penuh dinyalakan.
  { files: ['**/*.{ts,tsx}'], rules: { ...jsxA11y.flatConfigs.recommended.rules } },
  {
    rules: {
      // Service role tidak boleh disentuh kode klien (D-61, docs/07 §3.4).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase/admin',
              message: 'Hanya untuk Route Handler server (import langsung dari app/api).',
            },
          ],
        },
      ],
    },
  },
  { files: ['app/api/**/*.ts'], rules: { 'no-restricted-imports': 'off' } },
  { ignores: ['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
];

export default config;
