import type {
  GuestbookEntry,
  GuestbookResponse,
  GuestbookStatus,
  OverviewResponse,
} from './types';

function withJsonAccept(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  return { ...init, headers };
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, withJsonAccept(init));
  let payload: T & {
    error?: string;
  };

  try {
    payload = (await response.json()) as T & { error?: string };
  } catch {
    throw new Error('Admin API returned an invalid JSON response.');
  }

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }
  return payload;
}

export function fetchAdminOverview(): Promise<OverviewResponse> {
  return readJson<OverviewResponse>('/api/admin/overview', {
    cache: 'no-store',
  });
}

export async function fetchGuestbookEntries(
  status: GuestbookStatus,
): Promise<GuestbookEntry[]> {
  const data = await readJson<GuestbookResponse>(
    `/api/guestbook/admin?status=${status}`,
    { cache: 'no-store' },
  );
  return data.entries;
}

export function updateGuestbookEntryStatus(
  id: string,
  status: GuestbookStatus,
): Promise<GuestbookResponse> {
  return readJson<GuestbookResponse>('/api/guestbook/admin', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status }),
  });
}

export function clearGuestbookEntries(): Promise<GuestbookResponse> {
  return readJson<GuestbookResponse>('/api/guestbook/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear', all: true }),
  });
}
