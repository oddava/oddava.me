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
    resolve: {
      dedupe: ['yjs', 'react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['yjs', '@keystatic/astro/ui', '@keystatic/core/ui'],
    },
  },
});
