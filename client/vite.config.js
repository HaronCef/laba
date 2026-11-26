import { defineConfig } from 'vite';
import { slowAndFlaky } from './dev/devMiddleware.js';

// У розробці Vite (порт 5173) віддає клієнт, а /api і /ws пересилає на Node-сервер (порт 3000).
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
  plugins: [
    {
      name: 'slow-and-flaky',
      configureServer(server) {
        server.middlewares.use(slowAndFlaky);
      },
    },
  ],
});
