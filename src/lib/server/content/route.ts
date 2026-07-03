import type { APIContext } from 'astro';
import {
  adminJson,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../admin';
import { ensureSameOrigin } from '../community';
import { createGithubContentProvider } from './github-provider';
import {
  handleContentCollection,
  handleContentCollections,
  handleContentEntry,
  handleContentMedia,
  handleContentReorder,
} from './api';

function provider() {
  return createGithubContentProvider();
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
  const authError = await requireSecuredAdminApi(context.cookies);
  return authError;
}

async function requireMutation(context: APIContext): Promise<Response | null> {
  const sameOriginError = ensureSameOrigin(context.request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);
  return requireAdmin(context);
}

export async function adminContentCollectionsRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireAdmin(context);
  if (authError) return authError;
  return safeContentResponse(() => handleContentCollections(provider()));
}

export async function adminContentCollectionRoute(
  context: APIContext,
): Promise<Response> {
  const authError =
    context.request.method === 'GET'
      ? await requireAdmin(context)
      : await requireMutation(context);
  if (authError) return authError;

  return safeContentResponse(() =>
    handleContentCollection(
      provider(),
      context.params.collection,
      context.request,
    ),
  );
}

export async function adminContentEntryRoute(
  context: APIContext,
): Promise<Response> {
  const authError =
    context.request.method === 'GET'
      ? await requireAdmin(context)
      : await requireMutation(context);
  if (authError) return authError;

  return safeContentResponse(() =>
    handleContentEntry(
      provider(),
      context.params.collection,
      context.params.id,
      context.request,
    ),
  );
}

export async function adminContentMediaRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireMutation(context);
  if (authError) return authError;
  return safeContentResponse(() =>
    handleContentMedia(provider(), context.request),
  );
}

export async function adminContentReorderRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireMutation(context);
  if (authError) return authError;
  return safeContentResponse(() =>
    handleContentReorder(provider(), context.params.collection, context.request),
  );
}
