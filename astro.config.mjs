// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig, sessionDrivers } from 'astro/config';
import mdx from '@astrojs/mdx';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { localRedisDevProxy } from './vite/local-redis-dev-proxy.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @param {string | undefined} value */
function isConfiguredSecret(value) {
  if (!value?.trim()) return false;

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('your_')) return false;
  if (normalized.endsWith('_here')) return false;

  return true;
}

function hasSpotifyWidgetIntegration() {
  const env = {
    ...loadEnv('development', projectRoot, ''),
    ...loadEnv('production', projectRoot, ''),
  };

  return (
    (isConfiguredSecret(env.SPOTIFY_CLIENT_ID) &&
      isConfiguredSecret(env.SPOTIFY_CLIENT_SECRET) &&
      isConfiguredSecret(env.SPOTIFY_REFRESH_TOKEN)) ||
    isConfiguredSecret(env.DISCORD_USER_ID)
  );
}

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

/** @param {boolean} enabled @returns {import('vite').Plugin} */
function spotifyWidgetBuildStub(enabled) {
  const loaderId = path.resolve(
    projectRoot,
    'src/components/SpotifyWidgetLoader.astro',
  );
  const stubId = path.resolve(
    projectRoot,
    'src/components/SpotifyWidgetLoader.stub.astro',
  );

  return {
    name: 'spotify-widget-build-stub',
    enforce: 'pre',
    /** @param {string} id */
    resolveId(id) {
      if (!enabled && (id === loaderId || id.endsWith('SpotifyWidgetLoader.astro'))) {
        return stubId;
      }

      return null;
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

const spotifyWidgetEnabled = hasSpotifyWidgetIntegration();

export default defineConfig({
  integrations: [react(), mdx()],
  compressHTML: true,
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
    define: {
      __SPOTIFY_WIDGET_ENABLED__: JSON.stringify(spotifyWidgetEnabled),
    },
    server: {
      warmup: {
        clientFiles: [
          './src/layouts/Base.astro',
          './src/pages/index.astro',
          './src/styles/global.css',
        ],
      },
      watch: {
        ignored: ['**/dist/**', '**/.pnpm-store/**'],
      },
    },
    plugins: [
      spotifyWidgetBuildStub(spotifyWidgetEnabled),
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
