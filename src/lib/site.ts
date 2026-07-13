export const SITE_NAME = 'oddava';
export const SITE_URL = 'https://oddava.me';
export const SITE_DESCRIPTION = 'the notebook i keep out in the open.';
export const SITE_AUTHOR_NAME = 'oddava';
export const SITE_TWITTER_HANDLE = '@oddava';

// Integration credentials (the Discord/Lanyard user id, Spotify keys) are NOT
// hardcoded here. They are resolved at runtime by
// `src/lib/server/integrations/store.ts`: an operator-set override in Redis
// wins, then the deployment env, then "unconfigured". Set them in the admin
// panel, or in your `.env` (see `.env.example`) — not in this file.

export function siteUrl(path = '/'): string {
  return new URL(path, SITE_URL).toString();
}
