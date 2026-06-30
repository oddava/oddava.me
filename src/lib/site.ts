export const SITE_NAME = 'oddava';
export const SITE_URL = 'https://oddava.me';
export const SITE_DESCRIPTION = 'A quiet corner of the internet.';
export const SITE_AUTHOR_NAME = 'oddava';
export const SITE_TWITTER_HANDLE = '@oddava';

export function siteUrl(path = '/'): string {
  return new URL(path, SITE_URL).toString();
}
