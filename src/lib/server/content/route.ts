import type { APIContext } from 'astro';
import {
  adminJson,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../admin';
import {
  boundedRequest,
  delay,
  RequestBodyError,
  ensureSameOrigin,
} from '../core';
import {
  ContentMutationBusyError,
  createRedisContentProvider,
  hasContentStore,
  readStableContentVersion,
  withRedisContentMutationLock,
} from './redis-store';
import { contentStoreErrorResponse, contentStoreUnavailable } from './http';
import { dispatchContentRequest } from './router';

const MAX_CONTENT_REQUEST_BYTES = 6 * 1024 * 1024;
const STABLE_READ_ATTEMPTS = 30;
const STABLE_READ_RETRY_MS = 100;

function contentPayloadTooLarge(): Response {
  return adminJson(
    {
      error: 'Content requests are limited to 6 MB.',
      code: 'payload_too_large',
    },
    { status: 413 },
  );
}

async function dispatchRedisRequest(
  request: Request,
  mutation: boolean,
): Promise<Response> {
  if (!hasContentStore()) return contentStoreUnavailable();
  const provider = createRedisContentProvider();
  const bounded = await boundedRequest(request, MAX_CONTENT_REQUEST_BYTES);
  const dispatch = () =>
    Promise.resolve(dispatchContentRequest(provider, bounded));
  let response: Response;
  if (mutation) {
    response = await withRedisContentMutationLock(dispatch, {
      signal: request.signal,
    });
  } else {
    for (let attempt = 0; ; attempt += 1) {
      const version = await readStableContentVersion();
      if (version !== null) {
        const candidate = await dispatch();
        if ((await readStableContentVersion()) === version) {
          response = candidate;
          break;
        }
      }
      if (attempt >= STABLE_READ_ATTEMPTS - 1)
        throw new ContentMutationBusyError();
      await delay(STABLE_READ_RETRY_MS, request.signal);
    }
  }
  return withAdminSecurityHeaders(response);
}

async function dispatch(
  context: APIContext,
  mutation: boolean,
): Promise<Response> {
  const authError = await requireSecuredAdminApi(context.cookies);
  if (authError) return authError;
  if (mutation) {
    const originError = ensureSameOrigin(context.request);
    if (originError) return withAdminSecurityHeaders(originError);
  }

  try {
    return await dispatchRedisRequest(context.request, mutation);
  } catch (error) {
    if (
      error instanceof RequestBodyError &&
      error.code === 'payload_too_large'
    ) {
      return contentPayloadTooLarge();
    }
    const storeError = contentStoreErrorResponse(error);
    if (storeError) return storeError;
    const requestId = crypto.randomUUID();
    console.error(`[content] request failed (${requestId})`, error);
    return adminJson(
      {
        error: 'Studio could not complete the content request.',
        code: 'content_unavailable',
        requestId,
      },
      { status: 500 },
    );
  }
}

export function adminContentCollectionsRoute(
  context: APIContext,
): Promise<Response> {
  return dispatch(context, false);
}

export function adminContentCollectionRoute(
  context: APIContext,
): Promise<Response> {
  return dispatch(context, context.request.method !== 'GET');
}

export function adminContentEntryRoute(context: APIContext): Promise<Response> {
  return dispatch(context, context.request.method !== 'GET');
}

export function adminContentFoldersRoute(
  context: APIContext,
): Promise<Response> {
  return dispatch(context, context.request.method !== 'GET');
}

export function adminContentMoveRoute(context: APIContext): Promise<Response> {
  return dispatch(context, true);
}

export function adminContentReorderRoute(
  context: APIContext,
): Promise<Response> {
  return dispatch(context, true);
}

export function adminContentMediaRoute(context: APIContext): Promise<Response> {
  // Upload only, so always a mutation.
  return dispatch(context, true);
}
