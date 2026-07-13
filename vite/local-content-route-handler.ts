import {
  handleContentCollection,
  handleContentCollections,
  handleContentEntry,
  handleContentMove,
  handleContentReorder,
} from '../src/lib/server/content/entries';
import { handleContentFolders } from '../src/lib/server/content/folders';
import { methodNotAllowed } from '../src/lib/server/content/http';
import { createLocalContentProvider } from '../src/lib/server/content/local-provider';
import { handleContentMedia } from '../src/lib/server/content/media';

const CONTENT_API_PREFIX = '/api/admin/content/';

function notFound(): Response {
  return Response.json(
    { error: 'Content endpoint was not found.', code: 'not_found' },
    { status: 404 },
  );
}

function decodeSegments(pathname: string): string[] | null {
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

export function createLocalContentRouteHandler(projectRoot: string) {
  const provider = createLocalContentProvider(projectRoot);
  let mutationQueue: Promise<void> = Promise.resolve();

  function runMutation(operation: () => Promise<Response>): Promise<Response> {
    const pending = mutationQueue.then(operation);
    mutationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  return async (request: Request): Promise<Response> => {
    const dispatch = async (): Promise<Response> => {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith(CONTENT_API_PREFIX)) return notFound();
      const segments = decodeSegments(pathname);
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
    };

    // A mutation often spans several provider calls (read, validate, write,
    // re-read). Serialize the complete request so two writes cannot validate
    // against the same snapshot and reads never observe a half-finished move.
    return runMutation(dispatch);
  };
}
