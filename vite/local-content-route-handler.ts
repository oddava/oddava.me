import {
  handleContentCollection,
  handleContentCollections,
  handleContentDraft,
  handleContentEntry,
  handleContentFolders,
  handleContentHistory,
  handleContentMedia,
  handleContentMove,
  handleContentPreview,
  handleContentPublish,
  handleContentPublishJob,
  handleContentReorder,
  handleContentRestore,
  handleContentSurfaces,
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
      return handleContentCollections(provider, projectRoot);
    }
    if (parts.length === 1 && parts[0] === 'surfaces') {
      return handleContentSurfaces(projectRoot, provider, request);
    }
    if (parts.length === 1 && parts[0] === 'preview') {
      return handleContentPreview(projectRoot, provider, request);
    }
    if (parts.length === 1 && parts[0] === 'publish') {
      return handleContentPublish(projectRoot, provider, request);
    }
    if (parts.length === 2 && parts[0] === 'publish') {
      return handleContentPublishJob(projectRoot, parts[1]);
    }
    if (parts.length === 3 && parts[0] === 'drafts') {
      return handleContentDraft(
        projectRoot,
        provider,
        parts[1],
        parts[2],
        request,
      );
    }
    if (parts.length === 1 && parts[0] === 'media') {
      return handleContentMedia(provider, request, projectRoot);
    }
    if (parts.length === 2 && parts[1] === 'reorder') {
      return handleContentReorder(provider, parts[0], request);
    }
    if (parts.length === 2 && parts[1] === 'folders') {
      return handleContentFolders(provider, parts[0], request, projectRoot);
    }
    if (parts.length === 2 && parts[1] === 'move') {
      return handleContentMove(provider, parts[0], request, projectRoot);
    }
    if (parts.length === 3 && parts[2] === 'history') {
      return handleContentHistory(projectRoot, provider, parts[0], parts[1]);
    }
    if (parts.length === 3 && parts[2] === 'restore') {
      return handleContentRestore(
        projectRoot,
        provider,
        parts[0],
        parts[1],
        request,
      );
    }
    if (parts.length === 1) {
      return handleContentCollection(provider, parts[0], request, projectRoot);
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
