import type { ConnectionsPayload } from '../../../lib/garden/connections';
import { readContentJson } from './transport';

export function fetchConnections(
  noteId: string,
  signal?: AbortSignal,
): Promise<ConnectionsPayload> {
  return readContentJson<ConnectionsPayload>(
    `/api/admin/content/connections?id=${encodeURIComponent(noteId)}`,
    { cache: 'no-store', signal },
  );
}
