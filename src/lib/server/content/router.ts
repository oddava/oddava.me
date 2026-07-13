import {
  handleContentCollection,
  handleContentCollections,
  handleContentEntry,
  handleContentMove,
  handleContentReorder,
} from './entries';
import { handleContentFolders } from './folders';
import { methodNotAllowed } from './http';
import { handleContentMedia } from './media';
import type { ContentProvider } from './types';

const CONTENT_API_PREFIX = '/api/admin/content/';

function notFound(): Response {
  return Response.json(
    { error: 'Content endpoint was not found.', code: 'not_found' },
    { status: 404 },
  );
}

function decodeSegments(pathname: string): string[] | null {
  if (!pathname.startsWith(CONTENT_API_PREFIX)) return null;
  try {
    return pathname
      .slice(CONTENT_API_PREFIX.length)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** Dispatches the intentionally small Studio HTTP surface to domain handlers. */
export function dispatchContentRequest(
  provider: ContentProvider,
  request: Request,
): Promise<Response> | Response {
  const segments = decodeSegments(new URL(request.url).pathname);
  if (!segments) return notFound();

  if (segments.length === 1 && segments[0] === 'collections') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return handleContentCollections(provider);
  }
  if (segments.length === 1 && segments[0] === 'media') {
    return handleContentMedia(provider, request);
  }

  const [collection, action, extra] = segments;
  if (!collection || extra) return notFound();
  if (!action) {
    return handleContentCollection(provider, collection, request);
  }
  if (action === 'folders') {
    return handleContentFolders(provider, collection, request);
  }
  if (action === 'move') {
    return handleContentMove(provider, collection, request);
  }
  if (action === 'reorder') {
    return handleContentReorder(provider, collection, request);
  }
  return handleContentEntry(provider, collection, action, request);
}
