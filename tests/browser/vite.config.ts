import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [
    {
      name: 'preview-test-script',
      async load(id) {
        if (!id.endsWith('/PagePreview.astro?preview-test.ts')) return;
        const source = await readFile(id.split('?')[0], 'utf8');
        return source.match(/<script>([\s\S]*?)<\/script>/)![1];
      },
    },
  ],
  resolve: {
    alias: {
      '@styles': fileURLToPath(new URL('../../src/styles', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: 4179, strictPort: true },
  publicDir: 'public',
});
