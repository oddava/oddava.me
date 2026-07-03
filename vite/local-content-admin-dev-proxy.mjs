import { createHmac, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const ADMIN_COOKIE = 'oddava-admin-session';

/**
 * Serves the local-file content admin API from Node.js during `astro dev`.
 *
 * The Cloudflare adapter runs Astro API routes in workerd, where repository
 * file writes are unavailable. This proxy is enabled only when
 * CONTENT_WRITE_MODE=local and reuses the same signed admin cookie contract.
 *
 * @param {string} projectRoot
 * @returns {import('vite').Plugin}
 */
export function localContentAdminDevProxy(projectRoot) {
  /** @type {Promise<((request: Request) => Promise<Response>)> | null} */
  let routeHandlerPromise = null;

  return {
    name: 'local-content-admin-dev-proxy',
    configureServer(server) {
      if (server.config.command !== 'serve') return;
      if (server.config.mode !== 'development') return;
      const env = { ...server.config.env, ...process.env };
      if (env.CONTENT_WRITE_MODE !== 'local') return;

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/admin/content')) {
          next();
          return;
        }

        try {
          if (!routeHandlerPromise) {
            routeHandlerPromise = createRouteHandler(server, projectRoot);
          }

          const request = await toFetchRequest(req, server);
          if (!(await isAdminRequest(request, env))) {
            sendResponse(
              res,
              Response.json(
                { error: 'Unauthorized.', code: 'unauthorized' },
                { status: 401 },
              ),
            );
            return;
          }

          if (
            request.method !== 'GET' &&
            !isSameOriginRequest(request, server)
          ) {
            sendResponse(
              res,
              Response.json(
                { error: 'Cross-origin requests are not allowed.' },
                { status: 403 },
              ),
            );
            return;
          }

          const routeHandler = await routeHandlerPromise;
          sendResponse(res, await routeHandler(request));
        } catch (error) {
          sendResponse(
            res,
            Response.json(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : 'Local content admin failed.',
              },
              { status: 500 },
            ),
          );
        }
      });
    },
  };
}

async function createRouteHandler(server, projectRoot) {
  const [{ createLocalContentProvider }, api] = await Promise.all([
    server.ssrLoadModule('/src/lib/server/content/local-provider.ts'),
    server.ssrLoadModule('/src/lib/server/content/api.ts'),
  ]);
  const provider = createLocalContentProvider(projectRoot);

  return async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname
      .replace(/^\/api\/admin\/content\/?/, '')
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));

    if (parts.length === 1 && parts[0] === 'collections') {
      return api.handleContentCollections(provider);
    }
    if (parts.length === 1 && parts[0] === 'media') {
      return api.handleContentMedia(provider, request);
    }
    if (parts.length === 2 && parts[1] === 'reorder') {
      return api.handleContentReorder(provider, parts[0], request);
    }
    if (parts.length === 1) {
      return api.handleContentCollection(provider, parts[0], request);
    }
    if (parts.length === 2) {
      return api.handleContentEntry(provider, parts[0], parts[1], request);
    }

    return Response.json(
      { error: 'Content admin route was not found.', code: 'not_found' },
      { status: 404 },
    );
  };
}

async function toFetchRequest(req, server) {
  const protocol = 'http';
  const host = req.headers.host ?? `localhost:${server.config.server.port}`;
  const url = `${protocol}://${host}${req.url ?? '/'}`;
  const method = req.method ?? 'GET';
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.set(key, value);
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const body = Buffer.concat(chunks);
  return new Request(url, {
    method,
    headers,
    body: body.length > 0 ? body : undefined,
  });
}

async function sendResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function getCookieValue(request, name) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = cookieHeader.split(';').map((entry) => entry.trim());
  const prefix = `${name}=`;
  const match = cookies.find((entry) => entry.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

async function isAdminRequest(request, env) {
  const adminToken = env.ADMIN_PANEL_TOKEN ?? env.GUESTBOOK_ADMIN_TOKEN;
  const signingSecret = env.COMMUNITY_SIGNING_SECRET;
  if (!adminToken || !signingSecret) return false;

  const session = readSignedSession(
    getCookieValue(request, ADMIN_COOKIE),
    signingSecret,
  );
  if (!session || session.role !== 'admin' || !session.tokenHash) return false;

  const ageMs = Date.now() - Number(session.issuedAt ?? 0);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 12 * 60 * 60 * 1000) {
    return false;
  }

  return session.tokenHash === sha256(adminToken);
}

function readSignedSession(value, signingSecret) {
  if (!value) return null;
  const separatorIndex = value.lastIndexOf('.');
  if (separatorIndex === -1) return null;

  const body = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);
  if (signString(body, signingSecret) !== signature) return null;

  try {
    return JSON.parse(
      Buffer.from(base64UrlToBase64(body), 'base64').toString(),
    );
  } catch {
    return null;
  }
}

function signString(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function base64UrlToBase64(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return `${normalized}${padding}`;
}

function isSameOriginRequest(request) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const submittedOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!submittedOrigin) return false;
  return submittedOrigin === new URL(request.url).origin;
}
