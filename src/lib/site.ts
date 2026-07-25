export const SITE_NAME = 'oddava';
export const SITE_URL = 'https://oddava.me';
export const SITE_DESCRIPTION = 'the notebook i keep out in the open.';
/** Stands in for a note that never wrote its own summary. */
export const NOTE_FALLBACK_DESCRIPTION = 'a note from oddava’s digital garden.';
export const SITE_AUTHOR_NAME = 'oddava';
export const SITE_TWITTER_HANDLE = '@oddava';

// Integration credentials (the Discord/Lanyard user id, Spotify keys) are NOT
// hardcoded here. `src/lib/server/integrations/store.ts` resolves them from
// the deployment environment only — set them in your `.env` (see
// `.env.example`) or as Cloudflare secrets, not in this file.

export function siteUrl(path = '/'): string {
  return new URL(path, SITE_URL).toString();
}
