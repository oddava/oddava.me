/// <reference types="astro/client" />

declare const __SPOTIFY_WIDGET_ENABLED__: boolean;

declare module 'cloudflare:workers' {
  export const env: import('./lib/server/env').RuntimeEnv;
}
