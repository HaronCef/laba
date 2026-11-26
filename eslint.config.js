import js from '@eslint/js';

// ESLint перевіряє лише JS-файли, що лишились (конфіги інструментів).
// Увесь код гри тепер на TypeScript, і його перевіряє tsc у strict-режимі (npm run typecheck).
const node = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  URL: 'readonly',
};

export default [
  { ignores: ['**/dist/', '**/node_modules/', 'server/logs/', '**/*.ts'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: node },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
