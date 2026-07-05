// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import cloudflare from '@astrojs/cloudflare';
import preact from '@astrojs/preact';
import { localRedisDevProxy } from './vite/local-redis-dev-proxy.mjs';
import { localContentAdminDevProxy } from './vite/local-content-admin-dev-proxy.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// The Spotify widget is bundled by default. Set the build-time env var
// `SPOTIFY_WIDGET_ENABLED=false` to swap the loader for a stub and omit the
// widget bundle. Credentials are resolved at runtime from persistent storage
// (with environment fallback) so the admin panel can configure Spotify/Lanyard
// without a redeploy.
const spotifyWidgetEnabled =
  String(process.env.SPOTIFY_WIDGET_ENABLED ?? 'true').toLowerCase() !==
  'false';

// Pre-bundle island deps for the workerd SSR environment in one pass so Vite does
// not discover them lazily and reload Preact mid-render (duplicate hook context).
const SERVER_OPTIMIZE_DEPS = [
  'preact',
  'preact/hooks',
  'preact/compat',
  'preact/jsx-runtime',
  'preact-render-to-string',
  'astro/zod',
  'astro/assets/services/noop',
  'astro/content/runtime',
  'astro/app',
  'astro/runtime/server/astro-island',
];

const CLIENT_OPTIMIZE_DEPS = [
  'preact',
  'preact/hooks',
  'preact/compat',
  'preact/jsx-runtime',
];

/** @returns {import('vite').Plugin} */
function optimizeServerDeps() {
  return {
    name: 'optimize-server-deps',
    enforce: 'post',
    /** @param {string} name */
    configEnvironment(name) {
      if (name !== 'client') {
        return {
          optimizeDeps: { include: SERVER_OPTIMIZE_DEPS },
          // SSR dep prebundling runs with production defines, so jsx-dev-runtime
          // resolves to a stub where jsxDEV is undefined. Use jsx-runtime instead.
          esbuild: {
            jsx: 'automatic',
            jsxImportSource: 'preact',
            jsxDev: false,
          },
        };
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
      if (
        !enabled &&
        (id === loaderId || id.endsWith('SpotifyWidgetLoader.astro'))
      ) {
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

export default defineConfig({
  integrations: [preact({ compat: true }), mdx()],
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
  site: 'https://oddava.me',
  vite: {
    define: {
      __SPOTIFY_WIDGET_ENABLED__: JSON.stringify(spotifyWidgetEnabled),
    },
    server: {
      watch: {
        ignored: ['**/dist/**', '**/.pnpm-store/**'],
      },
    },
    plugins: [
      spotifyWidgetBuildStub(spotifyWidgetEnabled),
      localRedisDevProxy(),
      localContentAdminDevProxy(projectRoot),
      optimizeServerDeps(),
      devCloudflareWorkersEnv(),
    ],
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'preact',
      jsxDev: false,
    },
    resolve: {
      // Keep a single Preact copy across the SSR + client graphs so hooks share
      // one dispatcher (mixing copies throws "invalid hook call"-style errors).
      // react/react-dom are aliased to preact/compat by @astrojs/preact.
      dedupe: ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime'],
    },
    optimizeDeps: {
      include: CLIENT_OPTIMIZE_DEPS,
      holdUntilCrawlEnd: false,
    },
  },
});
