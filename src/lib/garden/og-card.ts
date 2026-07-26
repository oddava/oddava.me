import { folderTitle, formatNoteDate } from './utils';

/**
 * Part of every fingerprint, so bumping it retires every stored card at once:
 * `/og/*` stops finding the old key and falls back to the default card until
 * Studio's next sync draws the new artwork. Bump it whenever `drawSocialCard`
 * changes what a card looks like.
 */
const CARD_DESIGN_VERSION = 1;

/**
 * A character no card field can contain, written as an escape rather than
 * literally so this file stays plain text. Joining on a space would let a
 * title ending in a word the folder starts with fingerprint the same as its
 * neighbour, and two different notes would then share one card key.
 */
const FIELD_SEPARATOR = '\u0000';

export const SOCIAL_CARD_WIDTH = 1200;
export const SOCIAL_CARD_HEIGHT = 630;

/** The root note lives at `/notes`, so its path is empty. */
const ROOT_CARD_KEY = 'index';

export interface SocialCardSource {
  path: string;
  title: string;
  updated: string;
}

export interface SocialCard {
  /** Path key: a note's `path`, or `index` for the garden root. */
  path: string;
  title: string;
  /** Breadcrumb label for the note's folder, empty at the root. */
  folder: string;
  /** The same human date the note page prints. */
  date: string;
  fingerprint: string;
}

/**
 * FNV-1a. Only ever compared against the same note's own key, so the 32-bit
 * width is about "did this note's card text change", not global uniqueness.
 */
function fingerprintHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

export function socialCardKey(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
  return normalized || ROOT_CARD_KEY;
}

function folderLabel(path: string): string {
  const segments = path.split('/').filter(Boolean);
  segments.pop();
  return segments.map(folderTitle).join(' / ');
}

/**
 * Everything a card renders, plus the fingerprint of exactly that text. The
 * server derives this from the live index on both the read and the write path,
 * so a stored card can never claim to be current for text it does not show.
 */
export function noteSocialCard(source: SocialCardSource): SocialCard {
  const card = {
    path: socialCardKey(source.path),
    title: source.title,
    folder: folderLabel(source.path),
    date: formatNoteDate(source.updated),
  };

  return {
    ...card,
    fingerprint: fingerprintHash(
      [CARD_DESIGN_VERSION, card.path, card.title, card.folder, card.date].join(
        FIELD_SEPARATOR,
      ),
    ),
  };
}

/**
 * The note's own social image. The fingerprint rides along as `?v=` so a
 * redrawn card reaches crawlers and CDNs as a new URL; the route derives the
 * fingerprint from the index rather than trusting the query, and answers with
 * the site's default card while a note's own is still unrendered.
 */
export function noteSocialCardImage(source: SocialCardSource): {
  src: string;
  alt: string;
} {
  const card = noteSocialCard(source);
  return {
    src: `/og/${card.path}.png?v=${card.fingerprint}`,
    alt: `${card.title} — oddava.me`,
  };
}
