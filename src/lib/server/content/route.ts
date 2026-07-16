import type { APIContext } from 'astro';
import {
  adminJson,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../admin';
import {
  ensureSameOrigin,
  fetchWithTimeout,
  isStorageUnavailableError,
} from '../core';
import { getServerEnv } from '../env';
import { usesLocalContentFiles } from './mode';
import {
  ContentMutationBusyError,
  createRedisContentProvider,
  hasContentStore,
  readStableContentVersion,
  withRedisContentMutationLock,
} from './redis-store';
import { dispatchContentRequest } from './router';

const DEFAULT_LOCAL_CONTENT_PROXY_PORT = '45556';
const LOCAL_CONTENT_PROXY_TIMEOUT_MS = 30_000;
const MAX_CONTENT_REQUEST_BYTES = 6 * 1024 * 1024;

class ContentProxyUnavailableError extends Error {
  constructor() {
    super(
      'The local content service is not running. Restart the development server after setting CONTENT_WRITE_MODE=local.',
    );
    this.name = 'ContentProxyUnavailableError';
  }
}

class ContentPayloadTooLargeError extends Error {
  constructor() {
    super('Content requests are limited to 6 MB.');
    this.name = 'ContentPayloadTooLargeError';
  }
}

function localContentProxyUrl(): URL {
  const configured =
    getServerEnv('LOCAL_CONTENT_PROXY_URL') ??
    `http://127.0.0.1:${
      getServerEnv('LOCAL_CONTENT_PROXY_PORT') ??
      DEFAULT_LOCAL_CONTENT_PROXY_PORT
    }`;
  const url = new URL(configured);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(
      'LOCAL_CONTENT_PROXY_URL must use HTTP on a loopback hostname.',
    );
  }
  return url;
}

function contentStoreUnavailable(message?: string): Response {
  return adminJson(
    {
      error:
        message ??
        'Studio storage is not configured. Configure the production Redis credentials and try again.',
      code: 'content_store_unavailable',
    },
    { status: 503 },
  );
}

function contentPayloadTooLarge(): Response {
  return adminJson(
    {
      error: 'Content requests are limited to 6 MB.',
      code: 'payload_too_large',
    },
    { status: 413 },
  );
}

async function readBoundedRequestBody(request: Request): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_CONTENT_REQUEST_BYTES) {
    throw new ContentPayloadTooLargeError();
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CONTENT_REQUEST_BYTES) {
        await reader.cancel();
        throw new ContentPayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function boundedRequest(request: Request): Promise<Request> {
  if (request.method === 'GET' || request.method === 'HEAD') return request;
  const body = await readBoundedRequestBody(request);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: body as BodyInit,
    redirect: request.redirect,
    signal: request.signal,
  });
}

function waitForContentStore(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, 100);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function forwardToLocalContentService(
  request: Request,
): Promise<Response> {
  const originalUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `${originalUrl.pathname}${originalUrl.search}`,
    localContentProxyUrl(),
  );
  const headers = new Headers(request.headers);
  headers.set('x-original-url', request.url);
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: request.signal,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = (await readBoundedRequestBody(request)) as BodyInit;
  }

  const upstream = await fetchWithTimeout(
    upstreamUrl,
    init,
    LOCAL_CONTENT_PROXY_TIMEOUT_MS,
  ).catch((error) => {
    if (error instanceof ContentPayloadTooLargeError) throw error;
    throw new ContentProxyUnavailableError();
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  return withAdminSecurityHeaders(
    new Response(
      upstream.status === 204 ? null : await upstream.arrayBuffer(),
      {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      },
    ),
  );
}

async function dispatchRedisRequest(
  request: Request,
  mutation: boolean,
): Promise<Response> {
  if (!hasContentStore()) return contentStoreUnavailable();
  const provider = createRedisContentProvider();
  const bounded = await boundedRequest(request);
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
      if (attempt >= 29) throw new ContentMutationBusyError();
      await waitForContentStore(request.signal);
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
    if (usesLocalContentFiles()) {
      return await forwardToLocalContentService(context.request);
    }
    return await dispatchRedisRequest(context.request, mutation);
  } catch (error) {
    if (error instanceof ContentPayloadTooLargeError) {
      return contentPayloadTooLarge();
    }
    if (error instanceof ContentMutationBusyError) {
      return adminJson(
        { error: error.message, code: error.code },
        { status: 503, headers: { 'Retry-After': '1' } },
      );
    }
    if (error instanceof ContentProxyUnavailableError) {
      return adminJson(
        { error: error.message, code: 'content_proxy_unavailable' },
        { status: 503 },
      );
    }
    if (isStorageUnavailableError(error)) {
      return contentStoreUnavailable(
        'Studio could not reach its content store. Try again shortly.',
      );
    }
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
