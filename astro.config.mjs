// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

export default defineConfig({
  integrations: [react(), mdx()],
  trailingSlash: 'never',
  output: 'server',
  adapter: vercel(),
  site: 'https://oddava.me',
  vite: {
    plugins: [
      {
        name: 'keystatic-virtual-config',
        resolveId(id) {
          if (id === 'virtual:keystatic-config') {
            return this.resolve('./keystatic.config', './a');
          }
          return null;
        },
      },
    ],
    resolve: {
      dedupe: ['yjs', 'react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['yjs', '@keystatic/astro/ui', '@keystatic/core/ui'],
    },
  },
});
