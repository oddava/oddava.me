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
  // Notes render at runtime through `marked`, so Astro's own Markdown pipeline
  // is never used — but leaving Shiki as its default highlighter makes Astro warn
  // that its inline styles could loosen the hashed CSP. Turning it off matches
  // the documented security posture (no inline-style source) and quiets the warn.
  markdown: { syntaxHighlight: false },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self'",
        "font-src 'self'",
        "form-action 'self'",
        "frame-src 'none'",
        "img-src 'self' data: https:",
        "object-src 'none'",
      ],
      scriptDirective: {
        resources: ["'self'"],
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
    // Preact islands (Guestbook, Studio, Spotify) pull several entry points.
    // Vite's SSR optimizer is partial by default: after a config change it may
    // re-hash and leave `deps_ssr/preact_*.js` missing until a cold re-scan,
    // which surfaces as "file does not exist … optimize deps directory" on the
    // first island page hit. Pin the full surface used in dev SSR so the
    // prebundle is complete up front. `preact/compat` is required by Studio
    // (createPortal, memo) even without `compat: true` React aliases.
    optimizeDeps: {
      include: [
        'preact',
        'preact/hooks',
        'preact/compat',
        'preact/jsx-runtime',
        'preact/jsx-dev-runtime',
        'preact/debug',
        'preact/devtools',
      ],
    },
    ssr: {
      optimizeDeps: {
        include: [
          'preact',
          'preact/hooks',
          'preact/compat',
          'preact/jsx-runtime',
          'preact/jsx-dev-runtime',
          'preact/debug',
          'preact/devtools',
          'preact-render-to-string',
        ],
      },
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
