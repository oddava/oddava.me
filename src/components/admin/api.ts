import type {
  GuestbookEntry,
  GuestbookResponse,
  GuestbookStatus,
  OverviewResponse,
  SpotifyCredentialsResponse,
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

const ADMIN_OVERVIEW_TIMEOUT_MS = 12_000;

export function fetchAdminOverview(): Promise<OverviewResponse> {
  return readJson<OverviewResponse>('/api/admin/overview', {
    cache: 'no-store',
    signal: AbortSignal.timeout(ADMIN_OVERVIEW_TIMEOUT_MS),
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

export interface IntegrationSettingsResponse {
  integrations: Record<string, boolean>;
}

export function updateIntegrationSetting(
  name: string,
  enabled: boolean,
): Promise<IntegrationSettingsResponse> {
  return readJson<IntegrationSettingsResponse>('/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, enabled }),
  });
}

export function fetchSpotifyCredentials(): Promise<SpotifyCredentialsResponse> {
  return readJson<SpotifyCredentialsResponse>(
    '/api/admin/spotify-credentials',
    { cache: 'no-store' },
  );
}

export function updateSpotifyCredentials(body: {
  spotify?: {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
  };
  lanyard?: { discordUserId?: string };
}): Promise<SpotifyCredentialsResponse> {
  return readJson<SpotifyCredentialsResponse>(
    '/api/admin/spotify-credentials',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
