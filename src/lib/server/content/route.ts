import type { APIContext } from 'astro';
import {
  adminJson,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../admin';
import { ensureSameOrigin } from '../community';
import {
  handleContentCollection,
  handleContentCollections,
  handleContentEntry,
  handleContentFolders,
  handleContentMedia,
  handleContentMove,
  handleContentReorder,
} from './api';
import { createRedisContentProvider, hasContentStore } from './redis-store';

// Studio writes go straight to the Redis-backed content store, in dev and in
// production alike. Because Cloudflare Workers can't write the repo
// filesystem, this replaces the old "forward to a local Node proxy in dev,
// unavailable in prod" model: every environment now runs the same code path,
// so what you save in Studio is live immediately with no commit, push, or
// deploy. The provider holds only closures, so building it at module load
// issues no Redis calls.
const provider = createRedisContentProvider();

function storageUnavailable(): Response {
  return adminJson(
    {
      error:
        'Content storage is not configured. Set the Redis connection env vars.',
      code: 'storage_unavailable',
    },
    { status: 503 },
  );
}

// Draft/publish/preview/surfaces/history/restore belonged to the retired
// two-step CMS flow. Studio autosaves straight to the store now, so these are
// intentionally gone rather than silently forwarded somewhere.
function retiredEndpoint(): Response {
  return adminJson(
    {
      error: 'This content endpoint has been retired. Studio saves live.',
      code: 'content_editing_unavailable',
    },
    { status: 410 },
  );
}

async function safeContentResponse(
  action: () => Promise<Response>,
): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    return adminJson(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Content admin request failed.',
        code: 'content_unavailable',
      },
      { status: 500 },
    );
  }
}

async function requireAdmin(context: APIContext): Promise<Response | null> {
  return requireSecuredAdminApi(context.cookies);
}

async function requireMutation(context: APIContext): Promise<Response | null> {
  const sameOriginError = ensureSameOrigin(context.request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);
  return requireAdmin(context);
}

async function guard(
  context: APIContext,
  mutation: boolean,
): Promise<Response | null> {
  const authError = mutation
    ? await requireMutation(context)
    : await requireAdmin(context);
  if (authError) return authError;
  if (!hasContentStore()) return storageUnavailable();
  return null;
}

export async function adminContentCollectionsRoute(
  context: APIContext,
): Promise<Response> {
  const blocked = await guard(context, false);
  if (blocked) return blocked;
  return safeContentResponse(() => handleContentCollections(provider));
}

export async function adminContentCollectionRoute(
  context: APIContext,
): Promise<Response> {
  const blocked = await guard(context, context.request.method !== 'GET');
  if (blocked) return blocked;
  return safeContentResponse(() =>
    handleContentCollection(
      provider,
      context.params.collection,
      context.request,
    ),
  );
}

export async function adminContentEntryRoute(
  context: APIContext,
): Promise<Response> {
  const blocked = await guard(context, context.request.method !== 'GET');
  if (blocked) return blocked;
  return safeContentResponse(() =>
    handleContentEntry(
      provider,
      context.params.collection,
      context.params.id,
      context.request,
    ),
  );
}

export async function adminContentFoldersRoute(
  context: APIContext,
): Promise<Response> {
  const blocked = await guard(context, context.request.method !== 'GET');
  if (blocked) return blocked;
  return safeContentResponse(() =>
    handleContentFolders(provider, context.params.collection, context.request),
  );
}

export async function adminContentMoveRoute(
  context: APIContext,
): Promise<Response> {
  const blocked = await guard(context, true);
  if (blocked) return blocked;
  return safeContentResponse(() =>
    handleContentMove(provider, context.params.collection, context.request),
  );
}

export async function adminContentReorderRoute(
  context: APIContext,
): Promise<Response> {
  const blocked = await guard(context, true);
  if (blocked) return blocked;
  return safeContentResponse(() =>
    handleContentReorder(provider, context.params.collection, context.request),
  );
}

export async function adminContentMediaRoute(
  context: APIContext,
): Promise<Response> {
  const blocked = await guard(context, context.request.method !== 'GET');
  if (blocked) return blocked;
  return safeContentResponse(() =>
    handleContentMedia(provider, context.request),
  );
}

export async function adminContentSurfacesRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireAdmin(context);
  if (authError) return authError;
  return retiredEndpoint();
}

export async function adminContentDraftRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireAdmin(context);
  if (authError) return authError;
  return retiredEndpoint();
}

export async function adminContentPreviewRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireAdmin(context);
  if (authError) return authError;
  return retiredEndpoint();
}

export async function adminContentPublishRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireMutation(context);
  if (authError) return authError;
  return retiredEndpoint();
}

export async function adminContentPublishJobRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireAdmin(context);
  if (authError) return authError;
  return retiredEndpoint();
}

export async function adminContentHistoryRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireAdmin(context);
  if (authError) return authError;
  return retiredEndpoint();
}

export async function adminContentRestoreRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireMutation(context);
  if (authError) return authError;
  return retiredEndpoint();
}
