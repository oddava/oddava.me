import type { ContentSaveResponse } from '../../../lib/contracts';
import type {
  NoteRevisionResponse,
  NoteRevisionsResponse,
} from '../../../lib/history-contracts';
import { readContentJson, jsonBody } from './transport';

function historyPath(collection: string, id: string): string {
  return `/api/admin/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/history`;
}

export function fetchNoteVersions(
  collection: string,
  id: string,
  signal?: AbortSignal,
): Promise<NoteRevisionsResponse> {
  return readContentJson<NoteRevisionsResponse>(historyPath(collection, id), {
    cache: 'no-store',
    signal,
  });
}

export function fetchNoteVersion(
  collection: string,
  id: string,
  versionId: string,
  signal?: AbortSignal,
): Promise<NoteRevisionResponse> {
  return readContentJson<NoteRevisionResponse>(
    `${historyPath(collection, id)}?version=${encodeURIComponent(versionId)}`,
    { cache: 'no-store', signal },
  );
}

export function restoreNoteVersion(
  collection: string,
  id: string,
  versionId: string,
  revision: string,
): Promise<ContentSaveResponse> {
  return readContentJson<ContentSaveResponse>(
    historyPath(collection, id),
    jsonBody('POST', { versionId, revision }),
  );
}
