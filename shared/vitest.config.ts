import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node', // симуляція не повинна знати про DOM
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      // вимога лаби: shared/ покрито щонайменше на 85%
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
    },
  },
});
