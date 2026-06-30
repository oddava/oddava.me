/// <reference types="astro/client" />

declare const __SPOTIFY_WIDGET_ENABLED__: boolean;

declare module 'cloudflare:workers' {
  export const env: Record<string, string | undefined>;
}
