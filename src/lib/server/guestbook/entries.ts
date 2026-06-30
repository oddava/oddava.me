import type { PublicGuestbookEntry } from '../../contracts';
import { getClientFingerprint } from '../community';
import type { GuestbookStatus } from './status';

export interface GuestbookEntry extends PublicGuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string;
  status: GuestbookStatus;
  ipFingerprint?: string;
  userAgent?: string;
}

export async function createGuestbookEntry(
  request: Request,
  name: string,
  message: string,
): Promise<GuestbookEntry> {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    message,
    createdAt: new Date().toISOString(),
    status: 'pending',
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

  return {
    id: String(candidate.id),
    name: String(candidate.name),
    message: String(candidate.message),
    createdAt: String(candidate.createdAt),
    status:
      candidate.status === 'approved' || candidate.status === 'rejected'
        ? candidate.status
        : 'pending',
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
