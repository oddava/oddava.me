import {
  handleContentCollection,
  handleContentCollections,
  handleContentEntry,
  handleContentMedia,
  handleContentReorder,
} from '../src/lib/server/content/api';
import { createLocalContentProvider } from '../src/lib/server/content/local-provider';

export function createLocalContentRouteHandler(projectRoot: string) {
  const provider = createLocalContentProvider(projectRoot);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const parts = url.pathname
      .replace(/^\/api\/admin\/content\/?/, '')
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));

    if (parts.length === 1 && parts[0] === 'collections') {
      return handleContentCollections(provider);
    }
    if (parts.length === 1 && parts[0] === 'media') {
      return handleContentMedia(provider, request);
    }
    if (parts.length === 2 && parts[1] === 'reorder') {
      return handleContentReorder(provider, parts[0], request);
    }
    if (parts.length === 1) {
      return handleContentCollection(provider, parts[0], request);
    }
    if (parts.length === 2) {
      return handleContentEntry(provider, parts[0], parts[1], request);
    }

    return Response.json(
      { error: 'Content admin route was not found.', code: 'not_found' },
      { status: 404 },
    );
  };
}
