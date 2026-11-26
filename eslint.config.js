import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// ESLint з типами. Головне правило - no-floating-promises
// (Promise без await або .catch - помилку ніхто не побачить).
export default tseslint.config(
  { ignores: ['**/dist/', '**/node_modules/', 'server/logs/', 'client/experiments/', 'playwright-report/', 'test-results/', 'coverage/', '**/coverage/'] },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly', setTimeout: 'readonly', URL: 'readonly' },
    },
    rules: { 'no-var': 'error', 'prefer-const': 'error' },
  },
  {
    // service worker (PWA): свої глобальні змінні
    files: ['client/public/sw.js'],
    languageOptions: {
      globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', Response: 'readonly', location: 'readonly' },
    },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        // кожен .ts файл має належати одному з цих tsconfig
        project: [
          './shared/tsconfig.test.json',
          './server/tsconfig.json',
          './client/tsconfig.test.json',
          './client/tsconfig.scripts.json',
          './e2e/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
);
