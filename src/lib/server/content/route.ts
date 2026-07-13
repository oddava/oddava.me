import type { APIContext } from 'astro';
import {
  adminJson,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../admin';
import { ensureSameOrigin, fetchWithTimeout } from '../community';
import { getServerEnv } from '../env';

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

function isLocalContentDevelopment(): boolean {
  return import.meta.env.DEV && getServerEnv('CONTENT_WRITE_MODE') === 'local';
}

function contentEditingUnavailable(): Response {
  return adminJson(
    {
      error:
        'Studio editing is available only in local development. Edit and commit files under src/content, then deploy the repository.',
      code: 'content_editing_unavailable',
    },
    { status: 503 },
  );
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
    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_CONTENT_REQUEST_BYTES) {
      throw new ContentPayloadTooLargeError();
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_CONTENT_REQUEST_BYTES) {
      throw new ContentPayloadTooLargeError();
    }
    init.body = body;
  }

  const upstream = await fetchWithTimeout(
    upstreamUrl,
    init,
    LOCAL_CONTENT_PROXY_TIMEOUT_MS,
  ).catch(() => {
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
  if (!isLocalContentDevelopment()) return contentEditingUnavailable();

  try {
    return await forwardToLocalContentService(context.request);
  } catch (error) {
    if (error instanceof ContentPayloadTooLargeError) {
      return adminJson(
        { error: error.message, code: 'payload_too_large' },
        { status: 413 },
      );
    }
    if (error instanceof ContentProxyUnavailableError) {
      return adminJson(
        { error: error.message, code: 'content_proxy_unavailable' },
        { status: 503 },
      );
    }
    const requestId = crypto.randomUUID();
    console.error(`[content-proxy] request failed (${requestId})`, error);
    return adminJson(
      {
        error: 'The local content service is unavailable.',
        code: 'content_unavailable',
        requestId,
      },
      { status: 503 },
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
  return dispatch(context, context.request.method !== 'GET');
}
