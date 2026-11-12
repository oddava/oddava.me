import { createModeratedList } from '../core';
import { normalizeGuestbookEntry, type GuestbookEntry } from './entries';
import type { GuestbookStatus } from './status';

/**
 * The guestbook is a moderated list (core/moderated-list.ts): newest first,
 * approved entries never evicted, at most UNAPPROVED_ENTRY_LIMIT pending or
 * rejected entries kept behind them.
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

export async function appendGuestbookEntry(
  entry: GuestbookEntry,
): Promise<void> {
  await entries.append(entry);
}

export function updateGuestbookEntryStatus(
  id: string,
  status: GuestbookStatus,
): Promise<boolean> {
  return entries.setStatus(id, status);
}

/** The moderation surface the admin routes drive. */
export const guestbookModeration = {
  read: readGuestbookEntries,
  setStatus: updateGuestbookEntryStatus,
  clearUnapproved: clearUnapprovedGuestbookEntries,
};
