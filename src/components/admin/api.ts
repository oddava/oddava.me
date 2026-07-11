import type {
  GuestbookEntry,
  GuestbookResponse,
  GuestbookStatus,
  ContentBlock,
  ContentCollectionsResponse,
  ContentDeleteResponse,
  ContentDraft,
  ContentEntriesResponse,
  ContentEntryResponse,
  ContentFolder,
  ContentMediaListResponse,
  ContentMediaResponse,
  ContentRevision,
  ContentSaveResponse,
  ContentSurface,
  OverviewResponse,
  PublishJob,
  SpotifyCredentialsResponse,
} from './types';

const ADMIN_REQUEST_TIMEOUT_MS = 15_000;

function withJsonAccept(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  return { ...init, headers };
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const requestInit = withJsonAccept(init);
  requestInit.signal ??= AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS);
  const response = await fetch(input, requestInit);
  let payload: T & {
    error?: string;
    code?: string;
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
    const error = new Error(
      [payload.error || 'Request failed.', issueText].filter(Boolean).join(' '),
    );
    if (payload.code) (error as Error & { code?: string }).code = payload.code;
    throw error;
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

export function fetchContentSurfaces(path: string): Promise<{
  surfaces: ContentSurface[];
}> {
  return readJson<{ surfaces: ContentSurface[] }>(
    `/api/admin/content/surfaces?path=${encodeURIComponent(path)}`,
    { cache: 'no-store' },
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

export function fetchContentDraft(
  collection: string,
  id: string,
): Promise<{
  draft: ContentDraft | null;
  source: ContentEntryResponse['entry'] | null;
}> {
  return readJson<{
    draft: ContentDraft | null;
    source: ContentEntryResponse['entry'] | null;
  }>(
    `/api/admin/content/drafts/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    { cache: 'no-store' },
  );
}

export function saveContentDraft(
  collection: string,
  id: string,
  body: {
    folder?: string;
    fields: Record<string, unknown>;
    body?: string;
    blocks?: ContentBlock[];
    sourceRevision?: string;
    isNew?: boolean;
  },
): Promise<{ draft: ContentDraft }> {
  return readJson<{ draft: ContentDraft }>(
    `/api/admin/content/drafts/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export function deleteContentDraft(
  collection: string,
  id: string,
): Promise<{ deleted: boolean }> {
  return readJson<{ deleted: boolean }>(
    `/api/admin/content/drafts/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
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
    folder?: string;
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

export interface ContentFoldersResponse {
  folders: ContentFolder[];
  result?: ContentSaveResponse['result'];
}

export function createContentFolder(
  collection: string,
  path: string,
): Promise<ContentFoldersResponse> {
  return readJson<ContentFoldersResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/folders`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    },
  );
}

export function duplicateContentFolder(
  collection: string,
  path: string,
  copyFrom: string,
): Promise<ContentFoldersResponse> {
  return readJson<ContentFoldersResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/folders`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, copyFrom }),
    },
  );
}

export function updateContentFolder(
  collection: string,
  path: string,
  nextPath: string,
): Promise<ContentFoldersResponse> {
  return readJson<ContentFoldersResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/folders`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, nextPath }),
    },
  );
}

export function deleteContentFolder(
  collection: string,
  path: string,
): Promise<ContentFoldersResponse> {
  return readJson<ContentFoldersResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/folders`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    },
  );
}

export function moveContentEntry(
  collection: string,
  id: string,
  folder: string,
): Promise<{ entry: ContentEntryResponse['entry'] | null }> {
  return readJson<{ entry: ContentEntryResponse['entry'] | null }>(
    `/api/admin/content/${encodeURIComponent(collection)}/move`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, folder }),
    },
  );
}

export function renameContentEntry(
  collection: string,
  id: string,
  nextId: string,
  folder: string,
): Promise<{ entry: ContentEntryResponse['entry'] | null }> {
  return readJson<{ entry: ContentEntryResponse['entry'] | null }>(
    `/api/admin/content/${encodeURIComponent(collection)}/move`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, nextId, folder }),
    },
  );
}

export function duplicateContentEntry(
  collection: string,
  id: string,
  nextId: string,
  folder: string,
): Promise<{ entry: ContentEntryResponse['entry'] | null }> {
  return readJson<{ entry: ContentEntryResponse['entry'] | null }>(
    `/api/admin/content/${encodeURIComponent(collection)}/move`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, nextId, folder, operation: 'duplicate' }),
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
  folder: string,
  ids: string[],
): Promise<ContentReorderResponse> {
  return readJson<ContentReorderResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/reorder`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, ids }),
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

export function fetchContentMedia(): Promise<ContentMediaListResponse> {
  return readJson<ContentMediaListResponse>('/api/admin/content/media', {
    cache: 'no-store',
  });
}

export function deleteContentMedia(url: string): Promise<{ deleted: string }> {
  return readJson<{ deleted: string }>('/api/admin/content/media', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export function fetchContentHistory(
  collection: string,
  id: string,
): Promise<{ revisions: ContentRevision[] }> {
  return readJson<{ revisions: ContentRevision[] }>(
    `/api/admin/content/${encodeURIComponent(collection)}/${encodeURIComponent(
      id,
    )}/history`,
    { cache: 'no-store' },
  );
}

export function restoreContentRevision(
  collection: string,
  id: string,
  hash: string,
): Promise<{ draft: ContentDraft }> {
  return readJson<{ draft: ContentDraft }>(
    `/api/admin/content/${encodeURIComponent(collection)}/${encodeURIComponent(
      id,
    )}/restore`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash }),
    },
  );
}

export function publishContentDraft(body: {
  collection: string;
  id: string;
  runChecks?: boolean;
  commit?: boolean;
  push?: boolean;
  deploy?: boolean;
}): Promise<{ job: PublishJob; entry: ContentEntryResponse['entry'] | null }> {
  return readJson<{
    job: PublishJob;
    entry: ContentEntryResponse['entry'] | null;
  }>('/api/admin/content/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchPublishJob(id: string): Promise<{ job: PublishJob }> {
  return readJson<{ job: PublishJob }>(
    `/api/admin/content/publish/${encodeURIComponent(id)}`,
    { cache: 'no-store' },
  );
}
