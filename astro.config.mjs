// @ts-check
import { defineConfig, sessionDrivers } from 'astro/config';
import mdx from '@astrojs/mdx';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

/** @returns {import('vite').Plugin} */
function devCloudflareWorkersEnv() {
  let isDevServer = false;

  return {
    name: 'dev-cloudflare-workers-env',
    enforce: 'pre',
    /** @param {import('vite').ResolvedConfig} config */
    configResolved(config) {
      isDevServer = config.command === 'serve';
    },
    /** @param {string} id */
    resolveId(id) {
      if (isDevServer && id === 'cloudflare:workers') {
        return '\0dev-cloudflare-workers-env';
      }
      return null;
    },
    /** @param {string} id */
    load(id) {
      if (id === '\0dev-cloudflare-workers-env') {
        return 'export const env = import.meta.env;';
      }
      return null;
    },
  };
}

export default defineConfig({
  integrations: [react(), mdx()],
  trailingSlash: 'never',
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
  }),
  session: {
    driver: sessionDrivers.memory(),
  },
  site: 'https://oddava.me',
  vite: {
    server: {
      watch: {
        ignored: ['**/dist/**']
      }
    },
    plugins: [
      devCloudflareWorkersEnv(),
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
