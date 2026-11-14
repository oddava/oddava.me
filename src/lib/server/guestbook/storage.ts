import { createModeratedList } from '../core';
import { normalizeGuestbookEntry, type GuestbookEntry } from './entries';
import type { GuestbookStatus } from './status';

/**
 * The guestbook is a moderated list (core/moderated-list.ts): newest first,
 * approved entries never evicted, at most 100 pending or rejected entries
 * kept behind them. Pending means held: a clean entry is approved as it
 * lands, and the moderator takes down after the fact.
 */
const entries = createModeratedList<GuestbookEntry>({
  // Deliberately still `community:` — this is a live production key. The
  // domain rename to `core` is a code-level change; renaming the key would
  // orphan every stored entry.
  key: 'community:guestbook:entries',
  unapprovedLimit: 100,
  normalize: normalizeGuestbookEntry,
});

export function readGuestbookEntries(): Promise<GuestbookEntry[]> {
  return entries.read();
}

/**
 * Clears the moderation queue. Approved entries are published, so they are
 * never removed in bulk: a "clear" that also dropped them once wiped every
 * published message from production.
 */
export function clearUnapprovedGuestbookEntries(): Promise<number> {
  return entries.clearUnapproved();
}

/**
 * A message this long, posted again word for word, is pasted, not typed:
 * the repeat waits for the moderator. Shorter ones ("hello!", "nice site")
 * repeat by coincidence and publish.
 */
export const REPEAT_MIN_LENGTH = 24;

/**
 * Stores `entry`. A clean entry still waits for the moderator when its
 * network had an entry rejected before, or when it repeats a stored message
 * (REPEAT_MIN_LENGTH): both checked in the same EVAL as the push. Answers
 * `'held'` then, and marks `entry` pending to match what was stored.
 */
export async function appendGuestbookEntry(
  entry: GuestbookEntry,
): Promise<'ok' | 'held'> {
  const result = await entries.append(entry, {
    holdIf: [
      { field: 'ipFingerprint', status: 'rejected', reason: 'visitor' },
      ...(entry.message.length >= REPEAT_MIN_LENGTH
        ? [{ field: 'message', reason: 'repeat' }]
        : []),
    ],
  });
  if (result !== 'held') return 'ok';
  entry.status = 'pending';
  return 'held';
}

export function updateGuestbookEntryStatus(
  id: string,
  status: GuestbookStatus,
): Promise<boolean> {
  return entries.setStatus(id, status);
}

/** Sets `status` on every entry the network behind `id` left. */
export function updateVisitorGuestbookStatus(
  id: string,
  status: GuestbookStatus,
): Promise<number> {
  return entries.setStatusLike(id, 'ipFingerprint', status);
}

/** Sets `status` on every entry posted at or after `since` (ISO). */
export function updateGuestbookStatusSince(
  since: string,
  status: GuestbookStatus,
): Promise<number> {
  return entries.setStatusSince(since, status);
}

/** The moderation surface the admin routes drive. */
export const guestbookModeration = {
  read: readGuestbookEntries,
  setStatus: updateGuestbookEntryStatus,
  setVisitorStatus: updateVisitorGuestbookStatus,
  setStatusSince: updateGuestbookStatusSince,
  clearUnapproved: clearUnapprovedGuestbookEntries,
};
