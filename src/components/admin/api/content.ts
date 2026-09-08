import type {
  ContentCollectionsResponse,
  ContentDeleteResponse,
  ContentEntriesResponse,
  ContentEntryResponse,
  ContentEntryMove,
  ContentFolder,
  ContentMediaResponse,
  ContentSaveResponse,
} from '../../../lib/contracts';
import { readContentJson, jsonBody } from './transport';

function contentPath(collection: string, segment?: string): string {
  const path = `/api/admin/content/${encodeURIComponent(collection)}`;
  return segment === undefined
    ? path
    : `${path}/${encodeURIComponent(segment)}`;
}

export function fetchContentCollections(): Promise<ContentCollectionsResponse> {
  return readContentJson<ContentCollectionsResponse>(
    '/api/admin/content/collections',
    {
      cache: 'no-store',
    },
  );
}

export function fetchContentEntries(
  collection: string,
): Promise<ContentEntriesResponse> {
  return readContentJson<ContentEntriesResponse>(contentPath(collection), {
    cache: 'no-store',
  });
}

export function fetchContentEntry(
  collection: string,
  id: string,
): Promise<ContentEntryResponse> {
  return readContentJson<ContentEntryResponse>(contentPath(collection, id), {
    cache: 'no-store',
  });
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
  return readContentJson<ContentSaveResponse>(
    contentPath(collection),
    jsonBody('POST', body),
  );
}

export interface ContentFoldersResponse {
  folders: ContentFolder[];
  result?: ContentSaveResponse['result'];
  moved?: ContentEntryMove[];
}

export function createContentFolder(
  collection: string,
  path: string,
): Promise<ContentFoldersResponse> {
  return readContentJson<ContentFoldersResponse>(
    contentPath(collection, 'folders'),
    jsonBody('POST', { path }),
  );
}

export function duplicateContentFolder(
  collection: string,
  path: string,
  copyFrom: string,
): Promise<ContentFoldersResponse> {
  return readContentJson<ContentFoldersResponse>(
    contentPath(collection, 'folders'),
    jsonBody('POST', { path, copyFrom }),
  );
}

export function updateContentFolder(
  collection: string,
  path: string,
  nextPath: string,
): Promise<ContentFoldersResponse> {
  return readContentJson<ContentFoldersResponse>(
    contentPath(collection, 'folders'),
    jsonBody('PATCH', { path, nextPath }),
  );
}

export function deleteContentFolder(
  collection: string,
  path: string,
): Promise<ContentFoldersResponse> {
  return readContentJson<ContentFoldersResponse>(
    contentPath(collection, 'folders'),
    jsonBody('DELETE', { path }),
  );
}

export function moveContentEntry(
  collection: string,
  id: string,
  folder: string,
  revision: string,
): Promise<{ entry: ContentEntryResponse['entry'] | null }> {
  return readContentJson(
    contentPath(collection, 'move'),
    jsonBody('POST', { id, folder, revision }),
  );
}

export function renameContentEntry(
  collection: string,
  id: string,
  nextId: string,
  folder: string,
  revision: string,
): Promise<{ entry: ContentEntryResponse['entry'] | null }> {
  return readContentJson(
    contentPath(collection, 'move'),
    jsonBody('POST', { id, nextId, folder, revision }),
  );
}

export function duplicateContentEntry(
  collection: string,
  id: string,
  nextId: string,
  folder: string,
  revision: string,
): Promise<{ entry: ContentEntryResponse['entry'] | null }> {
  return readContentJson(
    contentPath(collection, 'move'),
    jsonBody('POST', {
      id,
      nextId,
      folder,
      revision,
      operation: 'duplicate',
    }),
  );
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
  return readContentJson<ContentSaveResponse>(
    contentPath(collection, id),
    jsonBody('PUT', body),
  );
}

export function deleteContentEntry(
  collection: string,
  id: string,
  revision: string,
): Promise<ContentDeleteResponse> {
  return readContentJson<ContentDeleteResponse>(
    contentPath(collection, id),
    jsonBody('DELETE', { revision }),
  );
}

export function reorderContentEntries(
  collection: string,
  folder: string,
  ids: string[],
): Promise<{
  reordered: { id: string; ok: boolean; revision?: string }[];
}> {
  return readContentJson(
    contentPath(collection, 'reorder'),
    jsonBody('POST', { folder, ids }),
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

  return readContentJson<ContentMediaResponse>('/api/admin/content/media', {
    method: 'POST',
    body: formData,
  });
}
