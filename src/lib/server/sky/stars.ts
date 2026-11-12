import type { PublicStar, StarRecord } from '../../contracts';
import { graphemes } from '../../graphemes';
import {
  getClientFingerprint,
  parseModerationStatus,
  sanitizePlainText,
} from '../core';

export type { StarRecord };

/** A word, not a message: room for "hi", a name, or "was here". */
export const STAR_WORD_MAX_LENGTH = 24;

/**
 * The most stars the sky holds. Stars are meant to stay, so the sky fills
 * rather than forgets. Rejected stars give their place back: the next star
 * placed into a full sky drops them first (core/moderated-list.ts).
 */
export const MAX_STARS = 1500;

/**
 * How many unapproved stars the list keeps before it evicts the oldest. A
 * pending star already shines, so evicting one would take a visitor's star
 * out of the sky with nobody deciding to: the limit is the whole sky, and a
 * full sky refuses new stars instead (MAX_STARS) until a moderator rejects.
 */
export const UNAPPROVED_STAR_LIMIT = MAX_STARS;

/** Sky coordinates keep four decimals: a tenth of a pixel on a 4K screen. */
const roundCoordinate = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * A coordinate from the request body, or null. Fractions of the sky, so a
 * star lands in the same place on a phone and a wide monitor.
 */
export function parseSkyCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return roundCoordinate(value);
}

/** Direction overrides, isolates and marks: they can flip how a word reads. */
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Zero-width spaces and joiners that are not part of an emoji, and BOMs. */
const INVISIBLE = /[\u200b\u200c\u2060\ufeff]/g;
/** More than two combining marks on one letter is decoration, not writing. */
const MARK_PILES = /(\p{M}{2})\p{M}+/gu;

/**
 * A star's word, cleaned: no markup, controls, direction tricks or
 * invisible characters, and at most STAR_WORD_MAX_LENGTH characters as a
 * person counts them (graphemes, so no emoji is ever cut in half).
 */
export function sanitizeStarWord(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = sanitizePlainText(
    value
      .replace(BIDI_CONTROLS, '')
      .replace(INVISIBLE, '')
      .replace(MARK_PILES, '$1'),
    STAR_WORD_MAX_LENGTH * 16,
  );
  return graphemes(clean).slice(0, STAR_WORD_MAX_LENGTH).join('').trim();
}

/**
 * A new star. With no word there is nothing to read, so it is approved at
 * once; a word waits for the moderator, and the star shines without it
 * until then.
 */
export async function createStar(
  request: Request,
  x: number,
  y: number,
  word: string,
): Promise<StarRecord> {
  return {
    id: crypto.randomUUID(),
    x,
    y,
    ...(word ? { word } : {}),
    createdAt: new Date().toISOString(),
    status: word ? 'pending' : 'approved',
    // Kept so a moderator can take back everything one visitor left. The
    // user agent is not: a star gives a moderator nothing to judge it by.
    ipFingerprint: await getClientFingerprint(request),
  };
}

export function normalizeStar(value: unknown): StarRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StarRecord>;
  const x = parseSkyCoordinate(candidate.x);
  const y = parseSkyCoordinate(candidate.y);
  if (!candidate.id || !candidate.createdAt || x === null || y === null) {
    return null;
  }
  const word = candidate.word ? String(candidate.word) : '';
  return {
    id: String(candidate.id),
    x,
    y,
    ...(word ? { word } : {}),
    createdAt: String(candidate.createdAt),
    status: parseModerationStatus(candidate.status) ?? 'pending',
    ipFingerprint: candidate.ipFingerprint
      ? String(candidate.ipFingerprint)
      : undefined,
    userAgent: candidate.userAgent ? String(candidate.userAgent) : undefined,
  };
}

function toMinute(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  return new Date(Math.floor(time / 60_000) * 60_000).toISOString();
}

export function toPublicStar(star: StarRecord): PublicStar {
  return {
    id: star.id,
    x: star.x,
    y: star.y,
    ...(star.word && star.status === 'approved' ? { word: star.word } : {}),
    // To the minute: enough for "left 3 hours ago", not a timing signal.
    createdAt: toMinute(star.createdAt),
  };
}

/**
 * The public sky: every star a moderator has not rejected, with a word only
 * once it is approved, and nothing that says who left it.
 */
export function getPublicStars(stars: StarRecord[]): PublicStar[] {
  return stars
    .filter((star) => star.status !== 'rejected')
    .map((star) => toPublicStar(star));
}
