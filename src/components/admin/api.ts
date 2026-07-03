import type {
  GuestbookEntry,
  GuestbookResponse,
  GuestbookStatus,
  ContentCollectionsResponse,
  ContentDeleteResponse,
  ContentEntriesResponse,
  ContentEntryResponse,
  ContentMediaResponse,
  ContentSaveResponse,
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
    issues?: { path?: unknown[]; message?: string }[];
  };

  try {
    payload = (await response.json()) as T & { error?: string };
  } catch {
    throw new Error('Admin API returned an invalid JSON response.');
  }

  if (!response.ok) {
    const issueText = Array.isArray(payload.issues)
      ? payload.issues
          .map((issue) => {
            const path = Array.isArray(issue.path)
              ? issue.path.join('.')
              : undefined;
            return path && issue.message
              ? `${path}: ${issue.message}`
              : issue.message;
          })
          .filter(Boolean)
          .join(' ')
      : '';
    throw new Error(
      [payload.error || 'Request failed.', issueText].filter(Boolean).join(' '),
    );
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

export function fetchContentCollections(): Promise<ContentCollectionsResponse> {
  return readJson<ContentCollectionsResponse>(
    '/api/admin/content/collections',
    {
      cache: 'no-store',
    },
  );
}

export function fetchContentEntries(
  collection: string,
): Promise<ContentEntriesResponse> {
  return readJson<ContentEntriesResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}`,
    { cache: 'no-store' },
  );
}

export function fetchContentEntry(
  collection: string,
  id: string,
): Promise<ContentEntryResponse> {
  return readJson<ContentEntryResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/${encodeURIComponent(
      id,
    )}`,
    { cache: 'no-store' },
  );
}

export function createContentEntry(
  collection: string,
  body: {
    slug?: string;
    fields: Record<string, unknown>;
    body?: string;
  },
): Promise<ContentSaveResponse> {
  return readJson<ContentSaveResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export function updateContentEntry(
  collection: string,
  id: string,
  body: {
    fields: Record<string, unknown>;
    body?: string;
    revision?: string;
  },
): Promise<ContentSaveResponse> {
  return readJson<ContentSaveResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/${encodeURIComponent(
      id,
    )}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export function deleteContentEntry(
  collection: string,
  id: string,
): Promise<ContentDeleteResponse> {
  return readJson<ContentDeleteResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/${encodeURIComponent(
      id,
    )}`,
    { method: 'DELETE' },
  );
}

export interface ContentReorderResponse {
  reordered: { id: string; ok: boolean }[];
}

export function reorderContentEntries(
  collection: string,
  ids: string[],
): Promise<ContentReorderResponse> {
  return readJson<ContentReorderResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/reorder`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    },
  );
}

export function uploadContentMedia(
  collection: string,
  entryId: string,
  file: File,
): Promise<ContentMediaResponse> {
  const formData = new FormData();
  formData.set('collection', collection);
  formData.set('entryId', entryId);
  formData.set('file', file);

  return readJson<ContentMediaResponse>('/api/admin/content/media', {
    method: 'POST',
    body: formData,
  });
}
