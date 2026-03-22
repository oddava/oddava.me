import { getClientFingerprint, hasRedisConfig, redisRequest } from './community';

export type GuestbookStatus = 'pending' | 'approved' | 'rejected';

export interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string;
  status: GuestbookStatus;
  ipFingerprint?: string;
  userAgent?: string;
}

const ENTRIES_KEY = 'community:guestbook:entries';
const ENCODED_ENTRIES_KEY = encodeURIComponent(ENTRIES_KEY);
const ENTRY_LIMIT = 100;

export async function readGuestbookEntries(): Promise<GuestbookEntry[]> {
  if (!hasRedisConfig()) return [];

  const response = await redisRequest(`lrange/${ENCODED_ENTRIES_KEY}/0/${ENTRY_LIMIT - 1}`);
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to read guestbook: ${response.status} ${details}`);
  }

  const data = (await response.json()) as { result: string[] | null };
  if (!data.result) return [];

  return data.result
    .map((raw) => {
      try {
        const entry = JSON.parse(raw) as GuestbookEntry;
        return normalizeGuestbookEntry(entry);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is GuestbookEntry => Boolean(entry));
}

export async function writeGuestbookEntries(entries: GuestbookEntry[]): Promise<void> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }

  const nextEntries = entries.slice(0, ENTRY_LIMIT);
  const deleteResponse = await redisRequest(`del/${ENCODED_ENTRIES_KEY}`);
  if (!deleteResponse.ok) {
    const details = await deleteResponse.text();
    throw new Error(`Failed to reset guestbook: ${deleteResponse.status} ${details}`);
  }

  if (nextEntries.length === 0) {
    return;
  }

  const payloads = nextEntries
    .slice()
    .reverse()
    .map((entry) => encodeURIComponent(JSON.stringify(entry)));

  const pushResponse = await redisRequest(`lpush/${ENCODED_ENTRIES_KEY}/${payloads.join('/')}`);
  if (!pushResponse.ok) {
    const details = await pushResponse.text();
    throw new Error(`Failed to write guestbook: ${pushResponse.status} ${details}`);
  }
}

export async function createGuestbookEntry(request: Request, name: string, message: string): Promise<GuestbookEntry> {
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

export function normalizeGuestbookEntry(entry: GuestbookEntry): GuestbookEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.id || !entry.name || !entry.message || !entry.createdAt) return null;

  return {
    id: String(entry.id),
    name: String(entry.name),
    message: String(entry.message),
    createdAt: String(entry.createdAt),
    status: entry.status === 'approved' || entry.status === 'rejected' ? entry.status : 'pending',
    ipFingerprint: entry.ipFingerprint ? String(entry.ipFingerprint) : undefined,
    userAgent: entry.userAgent ? String(entry.userAgent) : undefined,
  };
}

export function getApprovedGuestbookEntries(entries: GuestbookEntry[]): GuestbookEntry[] {
  return entries.filter((entry) => entry.status === 'approved');
}
