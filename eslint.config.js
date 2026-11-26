import js from '@eslint/js';

const browser = {
  window: 'readonly',
  document: 'readonly',
  location: 'readonly',
  console: 'readonly',
  performance: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  URLSearchParams: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  Image: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  DOMException: 'readonly',
  EventTarget: 'readonly',
  CustomEvent: 'readonly',
  AudioContext: 'readonly',
  WebSocket: 'readonly',
  TextEncoder: 'readonly',
};

const node = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  performance: 'readonly',
};

export default [
  { ignores: ['**/dist/', '**/node_modules/', 'server/logs/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  { files: ['client/src/**/*.js'], languageOptions: { globals: browser } },
  {
    files: [
      'server/**/*.js',
      'client/scripts/**/*.js',
      'client/dev/**/*.js',
      'shared/test/**/*.js',
      '**/*.config.js',
    ],
    languageOptions: { globals: node },
  },
  // shared/src свідомо без глобальних змінних браузера чи Node: симуляція має працювати всюди
];
