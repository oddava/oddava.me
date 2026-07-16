// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import preact from '@astrojs/preact';
import { localContentAdminDevProxy } from './vite/local-content-admin-dev-proxy.mjs';
import { localRedisDevProxy } from './vite/local-redis-dev-proxy.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Credentials resolve at runtime, but operators can omit the optional client
// island entirely. Vite replaces this constant at build time and removes the
// unreachable dynamic import in `spotify-widget-slot.ts`.
const spotifyWidgetEnabled =
  String(process.env.SPOTIFY_WIDGET_ENABLED ?? 'true').toLowerCase() !==
  'false';

export default defineConfig({
  integrations: [preact()],
  compressHTML: true,
  devToolbar: { enabled: false },
  prefetch: {
    defaultStrategy: 'hover',
  },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self' https://challenges.cloudflare.com",
        "font-src 'self'",
        "form-action 'self'",
        'frame-src https://challenges.cloudflare.com',
        "img-src 'self' data: https:",
        "object-src 'none'",
      ],
      scriptDirective: {
        resources: ["'self'", 'https://challenges.cloudflare.com'],
      },
      styleDirective: {
        resources: ["'self'"],
      },
    },
  },
  trailingSlash: 'never',
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
    // The build-time prerenderer does not need DevTools. Leaving the inspector
    // enabled makes Miniflare allocate an internal ephemeral port, which can
    // occasionally land on a Fetch-blocked port on Windows and fail the build.
    // Development keeps Cloudflare's inspector available as usual.
    inspectorPort: process.env.NODE_ENV === 'development' ? undefined : false,
  }),
  site: 'https://oddava.me',
  vite: {
    define: {
      __SPOTIFY_WIDGET_ENABLED__: JSON.stringify(spotifyWidgetEnabled),
    },
    server: {
      watch: {
        // Studio autosaves notes straight to src/content/notes. If Vite's
        // watcher saw those writes it would re-sync the content layer and send
        // a full page reload, wiping the editor mid-sentence on every save.
        // Studio reads notes back through the content API (fresh from disk), so
        // it never needs the watcher; ignore the notes tree in dev. Editing a
        // note file by hand won't hot-refresh public /notes pages until the dev
        // server restarts — an acceptable trade-off, since Studio is the way
        // notes are authored.
        ignored: ['**/dist/**', '**/.pnpm-store/**', '**/src/content/notes/**'],
      },
    },
    plugins: [localRedisDevProxy(), localContentAdminDevProxy(projectRoot)],
  },
});
