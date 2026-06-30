// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, sessionDrivers } from 'astro/config';
import mdx from '@astrojs/mdx';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { localRedisDevProxy } from './vite/local-redis-dev-proxy.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Pre-bundle island deps for the workerd SSR environment in one pass so Vite does
// not discover them lazily and reload React mid-render (invalid hook call).
const SERVER_OPTIMIZE_DEPS = [
  'react',
  'react-dom',
  'react-dom/server.edge',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@astrojs/react/server.js',
  '@astrojs/react/client.js',
  'astro/zod',
  'astro/assets/services/noop',
  'astro/content/runtime',
  'astro/app',
  'astro/runtime/server/astro-island',
  'astro/runtime/client/idle.js',
  'astro/runtime/client/visible.js',
  'astro/runtime/client/load.js',
];

const CLIENT_OPTIMIZE_DEPS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
];

/** @returns {import('vite').Plugin} */
function optimizeServerDeps() {
  return {
    name: 'optimize-server-deps',
    enforce: 'post',
    /** @param {string} name */
    configEnvironment(name) {
      if (name !== 'client') {
        return { optimizeDeps: { include: SERVER_OPTIMIZE_DEPS } };
      }
    },
  };
}

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
  devToolbar: { enabled: false },
  prefetch: {
    defaultStrategy: 'hover',
  },
  trailingSlash: 'never',
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
  }),
  session: {
    driver: sessionDrivers.lruCache(),
  },
  site: 'https://oddava.me',
  vite: {
    server: {
      watch: {
        ignored: ['**/dist/**'],
      },
    },
    plugins: [
      localRedisDevProxy(),
      optimizeServerDeps(),
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
      dedupe: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
      ],
      alias: {
        react: path.resolve(projectRoot, 'node_modules/react'),
        'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
        'react-dom/server': 'react-dom/server.edge',
      },
    },
    optimizeDeps: {
      include: CLIENT_OPTIMIZE_DEPS,
      holdUntilCrawlEnd: false,
    },
  },
});
