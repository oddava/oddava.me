/// <reference types="astro/client" />

declare const __SPOTIFY_WIDGET_ENABLED__: boolean;

interface ImportMetaEnv {
  /** Build-time base for notes links; see src/lib/notes-url.ts. */
  readonly PUBLIC_NOTES_BASE?: string;
}

declare module 'cloudflare:workers' {
  export const env: import('./lib/server/core/env').RuntimeEnv;
}
