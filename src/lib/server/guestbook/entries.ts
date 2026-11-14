import {
  parseHoldReason,
  type GuestbookEntry as GuestbookEntryContract,
  type PublicGuestbookEntry,
} from '../../contracts';
import { getClientFingerprint, screenText } from '../core';

export type GuestbookEntry = GuestbookEntryContract;

/**
 * A new entry. It publishes at once unless its name or message trips the
 * screen (core/screening.ts); then it waits for the moderator, with the
 * reason kept for the inbox. Storage can still hold a clean entry back
 * (guestbook/storage.ts).
 */
export async function createGuestbookEntry(
  request: Request,
  name: string,
  message: string,
): Promise<GuestbookEntry> {
  const held = screenText(message) ?? screenText(name);
  return {
    id: crypto.randomUUID(),
    name,
    message,
    createdAt: new Date().toISOString(),
    status: held ? 'pending' : 'approved',
    ...(held ? { held } : {}),
    ipFingerprint: await getClientFingerprint(request),
    userAgent: request.headers.get('user-agent')?.slice(0, 160) || undefined,
  };
}

export function normalizeGuestbookEntry(entry: unknown): GuestbookEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as Partial<GuestbookEntry>;
  if (
    !candidate.id ||
    !candidate.name ||
    !candidate.message ||
    !candidate.createdAt
  ) {
    return null;
  }

  const held = parseHoldReason(candidate.held);
  return {
    id: String(candidate.id),
    name: String(candidate.name),
    message: String(candidate.message),
    createdAt: String(candidate.createdAt),
    status:
      candidate.status === 'approved' || candidate.status === 'rejected'
        ? candidate.status
        : 'pending',
    ...(held ? { held } : {}),
    ipFingerprint: candidate.ipFingerprint
      ? String(candidate.ipFingerprint)
      : undefined,
    userAgent: candidate.userAgent ? String(candidate.userAgent) : undefined,
  };
}

export function getApprovedGuestbookEntries(
  entries: GuestbookEntry[],
): GuestbookEntry[] {
  return entries.filter((entry) => entry.status === 'approved');
}

export function toPublicGuestbookEntries(
  entries: GuestbookEntry[],
): PublicGuestbookEntry[] {
  return entries.map(({ id, name, message, createdAt }) => ({
    id,
    name,
    message,
    createdAt,
  }));
}

export const PUBLIC_GUESTBOOK_ENTRY_LIMIT = 100;

/**
 * Public read view: approved entries only, capped at the latest
 * PUBLIC_GUESTBOOK_ENTRY_LIMIT (the store is newest-first), private fields
 * stripped. The admin moderation path reads the full store via
 * readGuestbookEntries instead.
 */
export function getPublicGuestbookEntries(
  entries: GuestbookEntry[],
): PublicGuestbookEntry[] {
  return toPublicGuestbookEntries(
    getApprovedGuestbookEntries(entries).slice(0, PUBLIC_GUESTBOOK_ENTRY_LIMIT),
  );
}
