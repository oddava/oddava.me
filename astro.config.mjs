// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';
import node from '@astrojs/node';

export default defineConfig({
  integrations: [react(), keystatic(), mdx()],
  trailingSlash: 'never',
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  site: 'https://oddava.me',
});
