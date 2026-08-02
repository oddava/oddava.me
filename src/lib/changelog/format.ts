import type { Changelog, Release } from './types';

/** Display helpers. Nothing here is used while parsing — see `parse.ts`. */

const RELEASE_DATE = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  // The file stores a UTC calendar day. Formatting it in the runtime's local
  // zone would render the 6th as the 5th anywhere behind UTC, and the zone a
  // page was built in is not the reader's anyway.
  timeZone: 'UTC',
});

export function formatReleaseDate(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? day : RELEASE_DATE.format(parsed);
}

/**
 * What names the release on screen: its version, or — for a dated entry that
 * never got one — the day it landed. Never both, so the date beside it stays
 * metadata rather than a repeat of the heading.
 *
 * `Unreleased` is the one word here the site supplies rather than the author,
 * and the site writes its own words lowercase — the page title does the same.
 * A version or a date is left exactly as it was written.
 */
export function releaseHeadline(release: Release): string {
  if (release.unreleased) return 'unreleased';
  if (release.version) return release.version;
  return release.date ? formatReleaseDate(release.date) : release.label;
}

/**
 * A one-line summary for `<meta name="description">`, so the page describes its
 * actual contents rather than repeating a fixed blurb as the file grows.
 */
export function describeChangelog(changelog: Changelog): string {
  const shipped = changelog.releases.filter((release) => !release.unreleased);
  const latest = shipped[0];
  const count = shipped.length;
  const releases = `${count} release${count === 1 ? '' : 's'}`;

  if (!latest) return 'what has landed on this site, newest first.';
  const named = latest.version ? `${latest.version}, ` : '';
  const when = latest.date ? formatReleaseDate(latest.date) : 'recently';
  return `what has landed on this site, newest first — ${releases}, latest ${named}${when}.`;
}
