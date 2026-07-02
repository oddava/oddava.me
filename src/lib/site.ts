export const SITE_NAME = 'oddava';
export const SITE_URL = 'https://oddava.me';
export const SITE_DESCRIPTION = 'A quiet corner of the internet.';
export const SITE_AUTHOR_NAME = 'oddava';
export const SITE_TWITTER_HANDLE = '@oddava';
export const SITE_DISCORD_USER_ID = '970369176277516288';

export function siteUrl(path = '/'): string {
  return new URL(path, SITE_URL).toString();
}
