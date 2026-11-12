import { createModeratedList, type ModerationStatus } from '../core';
import {
  MAX_STARS,
  normalizeStar,
  UNAPPROVED_STAR_LIMIT,
  type StarRecord,
} from './stars';

/**
 * The sky is a moderated list, like the guestbook (core/moderated-list.ts):
 * newest first, approved stars never evicted, the oldest pending words
 * dropped first when spam piles up, and the whole list capped at MAX_STARS.
 */
const stars = createModeratedList<StarRecord>({
  key: 'sky:stars',
  unapprovedLimit: UNAPPROVED_STAR_LIMIT,
  normalize: normalizeStar,
});

export function readStars(): Promise<StarRecord[]> {
  return stars.read();
}

/** Answers 'full' when the sky already holds MAX_STARS. */
export function appendStar(star: StarRecord): Promise<'ok' | 'full'> {
  return stars.append(star, MAX_STARS);
}

export function updateStarStatus(
  id: string,
  status: ModerationStatus,
): Promise<boolean> {
  return stars.setStatus(id, status);
}

export function clearUnapprovedStars(): Promise<number> {
  return stars.clearUnapproved();
}

/**
 * Sets `status` on every star left by the visitor who left `id`: one
 * decision for someone who filled a corner of the sky.
 */
export function updateVisitorStarStatus(
  id: string,
  status: ModerationStatus,
): Promise<number> {
  return stars.setStatusLike(id, 'ipFingerprint', status);
}

/** Sets `status` on every star placed at or after `since` (ISO). */
export function updateStarStatusSince(
  since: string,
  status: ModerationStatus,
): Promise<number> {
  return stars.setStatusSince(since, status);
}

/** The moderation surface the admin routes drive. */
export const starModeration = {
  read: readStars,
  setStatus: updateStarStatus,
  setVisitorStatus: updateVisitorStarStatus,
  setStatusSince: updateStarStatusSince,
  clearUnapproved: clearUnapprovedStars,
};
