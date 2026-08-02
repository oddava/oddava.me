import source from '../../../CHANGELOG.md?raw';
import { parseChangelog } from './parse';
import type { Changelog } from './types';

/**
 * The changelog domain: `CHANGELOG.md` at the repo root is the only source.
 *
 * The file is inlined at build time and `/changelog` prerenders, so a malformed
 * changelog fails the build instead of the page, and serving one costs nothing
 * at runtime. Publishing an entry is editing that file and pushing.
 */

export * from './types';
export { latestRelease, parseChangelog } from './parse';
export {
  describeChangelog,
  formatReleaseDate,
  releaseHeadline,
} from './format';

/** Where a reader can see the file this page is built from. */
export const CHANGELOG_SOURCE_URL =
  'https://github.com/oddava/oddava.me/blob/main/CHANGELOG.md';

let parsed: Changelog | null = null;

/** The committed changelog, parsed once per module instance. */
export function loadChangelog(): Changelog {
  parsed ??= parseChangelog(source);
  return parsed;
}
