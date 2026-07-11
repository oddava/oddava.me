export const SITE_NAME = 'oddava';
export const SITE_URL = 'https://oddava.me';
export const SITE_DESCRIPTION = 'the notebook i keep out in the open.';
export const SITE_AUTHOR_NAME = 'oddava';
export const SITE_TWITTER_HANDLE = '@oddava';

// The Discord/Lanyard user id is NOT hardcoded here. It is resolved at runtime
// by `src/lib/server/spotify/credentials.ts` in this order:
//   1. Redis override (`admin:spotify-credentials`)
//   2. env (`DISCORD_USER_ID`, `LANYARD_DISCORD_USER_ID`,
//      `SPOTIFY_DISCORD_USER_ID`)
//   3. none → "unconfigured"
// Add the id to your `.env` (see `.env.example`) instead of editing this file.

export function siteUrl(path = '/'): string {
  return new URL(path, SITE_URL).toString();
}
