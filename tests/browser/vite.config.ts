import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
export default defineConfig({
  resolve: {
    alias: {
      '@styles': fileURLToPath(new URL('../../src/styles', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: 4179, strictPort: true },
  publicDir: 'public',
});
