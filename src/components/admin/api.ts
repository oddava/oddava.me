import type {
  ContentCollectionsResponse,
  ContentDeleteResponse,
  ContentEntriesResponse,
  ContentEntryResponse,
  ContentFolder,
  ContentMediaResponse,
  ContentSaveResponse,
  GuestbookEntry,
  GuestbookResponse,
  GuestbookStatus,
  IntegrationResponse,
  IntegrationsResponse,
  OverviewResponse,
} from '../../lib/contracts';

const ADMIN_REQUEST_TIMEOUT_MS = 15_000;
const ADMIN_OVERVIEW_TIMEOUT_MS = 12_000;
const INTEGRATION_TEST_TIMEOUT_MS = 20_000;
const INTEGRATIONS_PATH = '/api/admin/integrations';

interface AdminApiIssue {
  path: unknown[];
  message: string;
}

class AdminApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly issues: AdminApiIssue[] = [],
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

function withJsonAccept(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
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
    payload = await response.json();
  } catch {
    throw new AdminApiError('Admin API returned an invalid JSON response.');
  }

  if (!response.ok) {
    const issues = Array.isArray(payload.issues)
      ? payload.issues
          .filter(
            (issue): issue is { path?: unknown[]; message: string } =>
              typeof issue.message === 'string',
          )
          .map((issue) => ({
            path: Array.isArray(issue.path) ? issue.path : [],
            message: issue.message,
          }))
      : [];
    throw new AdminApiError(
      payload.error || 'Request failed.',
      payload.code,
      issues,
    );
  }

  return payload;
}

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

function integrationPath(id: string, suffix = ''): string {
  return `${INTEGRATIONS_PATH}/${encodeURIComponent(id)}${suffix}`;
}

export function fetchIntegrations(): Promise<IntegrationsResponse> {
  return readJson<IntegrationsResponse>(INTEGRATIONS_PATH, {
    cache: 'no-store',
  });
}

export function toggleIntegration(
  id: string,
  enabled: boolean,
): Promise<IntegrationResponse> {
  return readJson<IntegrationResponse>(integrationPath(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export function testIntegration(id: string): Promise<IntegrationResponse> {
  return readJson<IntegrationResponse>(integrationPath(id, '/test'), {
    method: 'POST',
    signal: AbortSignal.timeout(INTEGRATION_TEST_TIMEOUT_MS),
  });
}

export function saveIntegrationCredentials(
  id: string,
  credentials: Record<string, string>,
): Promise<IntegrationResponse> {
  return readJson<IntegrationResponse>(integrationPath(id, '/credentials'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(INTEGRATION_TEST_TIMEOUT_MS),
  });
}

export function revokeIntegrationCredentials(
  id: string,
): Promise<IntegrationResponse> {
  return readJson<IntegrationResponse>(integrationPath(id, '/credentials'), {
    method: 'DELETE',
    signal: AbortSignal.timeout(INTEGRATION_TEST_TIMEOUT_MS),
  });
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

function contentFoldersPath(collection: string): string {
  return `/api/admin/content/${encodeURIComponent(collection)}/folders`;
}

export function createContentFolder(
  collection: string,
  path: string,
): Promise<ContentFoldersResponse> {
  return readJson<ContentFoldersResponse>(contentFoldersPath(collection), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export function duplicateContentFolder(
  collection: string,
  path: string,
  copyFrom: string,
): Promise<ContentFoldersResponse> {
  return readJson<ContentFoldersResponse>(contentFoldersPath(collection), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, copyFrom }),
  });
}

export function updateContentFolder(
  collection: string,
  path: string,
  nextPath: string,
): Promise<ContentFoldersResponse> {
  return readJson<ContentFoldersResponse>(contentFoldersPath(collection), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, nextPath }),
  });
}

export function deleteContentFolder(
  collection: string,
  path: string,
): Promise<ContentFoldersResponse> {
  return readJson<ContentFoldersResponse>(contentFoldersPath(collection), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

function contentMovePath(collection: string): string {
  return `/api/admin/content/${encodeURIComponent(collection)}/move`;
}

export function moveContentEntry(
  collection: string,
  id: string,
  folder: string,
  revision: string,
): Promise<{ entry: ContentEntryResponse['entry'] | null }> {
  return readJson(contentMovePath(collection), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, folder, revision }),
  });
}

export function renameContentEntry(
  collection: string,
  id: string,
  nextId: string,
  folder: string,
  revision: string,
): Promise<{ entry: ContentEntryResponse['entry'] | null }> {
  return readJson(contentMovePath(collection), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, nextId, folder, revision }),
  });
}

export function duplicateContentEntry(
  collection: string,
  id: string,
  nextId: string,
  folder: string,
  revision: string,
): Promise<{ entry: ContentEntryResponse['entry'] | null }> {
  return readJson(contentMovePath(collection), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      nextId,
      folder,
      revision,
      operation: 'duplicate',
    }),
  });
}

export function updateContentEntry(
  collection: string,
  id: string,
  body: {
    fields: Record<string, unknown>;
    body?: string;
    revision: string;
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
  revision: string,
): Promise<ContentDeleteResponse> {
  return readJson<ContentDeleteResponse>(
    `/api/admin/content/${encodeURIComponent(collection)}/${encodeURIComponent(
      id,
    )}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision }),
    },
  );
}

export function reorderContentEntries(
  collection: string,
  folder: string,
  ids: string[],
): Promise<{
  reordered: { id: string; ok: boolean; revision?: string }[];
}> {
  return readJson(
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
