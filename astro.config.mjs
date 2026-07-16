// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import preact from '@astrojs/preact';
import { localRedisDevProxy } from './vite/local-redis-dev-proxy.mjs';

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
    // Not dead config, despite nothing importing `astro:assets` today: this
    // overrides the adapter's default, which is to route images through
    // Cloudflare Images and expect an `IMAGES` binding that wrangler.jsonc does
    // not declare. Dropping the line is silent until the first <Image>, and
    // then it fails at runtime rather than at build.
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
        // src/content/notes is an export artifact, not a source: Studio writes
        // Redis, and nothing reads this tree at runtime or at build time. Only
        // `notes:export` writes it, in bulk. Letting Vite watch it would mean a
        // full page reload per written file for a tree that changes nothing —
        // so ignore it in dev.
        ignored: ['**/dist/**', '**/.pnpm-store/**', '**/src/content/notes/**'],
      },
    },
    plugins: [localRedisDevProxy()],
  },
});
