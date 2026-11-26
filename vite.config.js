import { defineConfig } from 'vite';
import { slowAndFlaky } from './server/devMiddleware.js';

export default defineConfig({
  plugins: [
    {
      name: 'slow-and-flaky',
      configureServer(server) {
        server.middlewares.use(slowAndFlaky);
      },
    },
  ],
});
