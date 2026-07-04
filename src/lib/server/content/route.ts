import type { APIContext } from 'astro';
import {
  adminJson,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../admin';
import { ensureSameOrigin } from '../community';
import { getServerEnv } from '../env';

const DEFAULT_LOCAL_CONTENT_PROXY_PORT = '45556';

class ContentProxyUnavailableError extends Error {
  constructor() {
    super(
      'Local content proxy is not running. Restart `pnpm run dev` after setting CONTENT_WRITE_MODE=local.',
    );
  }
}

function getLocalContentProxyUrl(): string {
  return (
    getServerEnv('LOCAL_CONTENT_PROXY_URL') ??
    `http://127.0.0.1:${
      getServerEnv('LOCAL_CONTENT_PROXY_PORT') ??
      DEFAULT_LOCAL_CONTENT_PROXY_PORT
    }`
  );
}

function isLocalContentDev(): boolean {
  return (
    import.meta.env.DEV === true &&
    getServerEnv('CONTENT_WRITE_MODE') === 'local'
  );
}

function contentEditingUnavailable(): Response {
  return adminJson(
    {
      error:
        'Content editing is only available in local development. Edit files under src/content/, then commit, push, and run `pnpm run deploy`.',
      code: 'content_editing_unavailable',
    },
    { status: 503 },
  );
}

async function forwardToLocalProxy(
  context: APIContext,
  pathSuffix: string,
): Promise<Response> {
  const proxyUrl = new URL(pathSuffix, getLocalContentProxyUrl()).href;
  const headers = new Headers(context.request.headers);
  headers.set('x-original-url', context.request.url);
  const init: RequestInit = {
    method: context.request.method,
    headers,
    redirect: 'manual',
  };
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    init.body = await context.request.arrayBuffer();
  }
  const upstream = await fetch(proxyUrl, init).catch(() => {
    throw new ContentProxyUnavailableError();
  });
  const body =
    upstream.body && upstream.status !== 204
      ? await upstream.arrayBuffer()
      : null;
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-encoding');
  return new Response(body ?? null, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function safeContentResponse(
  action: () => Promise<Response>,
): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ContentProxyUnavailableError) {
      return adminJson(
        {
          error: error.message,
          code: 'content_proxy_unavailable',
        },
        { status: 503 },
      );
    }

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
  if (!isLocalContentDev()) return contentEditingUnavailable();
  return safeContentResponse(() =>
    forwardToLocalProxy(context, '/api/admin/content/collections'),
  );
}

export async function adminContentCollectionRoute(
  context: APIContext,
): Promise<Response> {
  const authError =
    context.request.method === 'GET'
      ? await requireAdmin(context)
      : await requireMutation(context);
  if (authError) return authError;

  const collectionId = context.params.collection ?? '';
  if (!isLocalContentDev()) return contentEditingUnavailable();
  return safeContentResponse(() =>
    forwardToLocalProxy(
      context,
      `/api/admin/content/${encodeURIComponent(collectionId)}`,
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

  const collectionId = context.params.collection ?? '';
  const id = context.params.id ?? '';
  if (!isLocalContentDev()) return contentEditingUnavailable();
  return safeContentResponse(() =>
    forwardToLocalProxy(
      context,
      `/api/admin/content/${encodeURIComponent(collectionId)}/${encodeURIComponent(id)}`,
    ),
  );
}

export async function adminContentMediaRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireMutation(context);
  if (authError) return authError;
  if (!isLocalContentDev()) return contentEditingUnavailable();
  return safeContentResponse(() =>
    forwardToLocalProxy(context, '/api/admin/content/media'),
  );
}

export async function adminContentReorderRoute(
  context: APIContext,
): Promise<Response> {
  const authError = await requireMutation(context);
  if (authError) return authError;
  const collectionId = context.params.collection ?? '';
  if (!isLocalContentDev()) return contentEditingUnavailable();
  return safeContentResponse(() =>
    forwardToLocalProxy(
      context,
      `/api/admin/content/${encodeURIComponent(collectionId)}/reorder`,
    ),
  );
}
