export const SITE_NAME = 'oddava';
/** The one way the site describes its author; every page, card and feed reuses it. */
export const SITE_ROLE = 'backend developer';
/** The homepage title, and what search results and link previews lead with. */
export const SITE_TITLE = `${SITE_NAME} | ${SITE_ROLE}`;
export const SITE_URL = 'https://oddava.me';
export const SITE_DESCRIPTION = `${SITE_NAME} is a ${SITE_ROLE}. Notes on the software I build, the books I read, and what I learn along the way.`;
/** Stands in for a note that never wrote its own summary. */
export const NOTE_FALLBACK_DESCRIPTION = `A note by ${SITE_NAME}, a ${SITE_ROLE}.`;
export const NOTES_DESCRIPTION = `Notes from ${SITE_NAME}: project write-ups, reading notes, and things worth remembering.`;
export const SITE_AUTHOR_NAME = 'oddava';
export const SITE_TWITTER_HANDLE = '@oddava';

// Integration credentials (the Discord/Lanyard user id, Spotify keys) are NOT
// hardcoded here. `src/lib/server/integrations/store.ts` resolves them from
// the deployment environment only — set them in your `.env` (see
// `.env.example`) or as Cloudflare secrets, not in this file.

export function siteUrl(path = '/'): string {
  return new URL(path, SITE_URL).toString();
}
