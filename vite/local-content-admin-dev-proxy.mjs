import { Buffer } from 'node:buffer';
import http from 'node:http';
import path from 'node:path';
import { loadEnv, runnerImport } from 'vite';
import {
  closeHttpServer,
  registerDevProxyCleanup,
} from './dev-proxy-lifecycle.mjs';
import { firstConfiguredSecret } from './dev-secrets.mjs';

const DEFAULT_PROXY_PORT = 45556;
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.');
    this.name = 'RequestBodyTooLargeError';
  }
}

/** @param {string} value */
function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid LOCAL_CONTENT_PROXY_PORT: ${value}`);
  }
  return port;
}

/**
 * @typedef {{
 *   ADMIN_COOKIE: string,
 *   computeTokenHash(token: string): Promise<string>,
 *   constantTimeCompare(left: string, right: string): boolean,
 *   verifySession(value: string | undefined, secret: string): Promise<{ tokenHash: string } | null>
 * }} AuthShared
 */

/**
 * Runs the filesystem-backed content API beside Astro during local
 * development. Cloudflare's workerd runtime cannot write the repository, and
 * its request pipeline does not pass through Vite middleware, so a loopback
 * HTTP server is the smallest reliable bridge.
 *
 * @param {string} projectRoot
 * @returns {import('vite').Plugin}
 */
export function localContentAdminDevProxy(projectRoot) {
  /** @type {http.Server | null} */
  let server = null;
  /** @type {Promise<(request: Request) => Promise<Response>> | null} */
  let routeHandlerPromise = null;
  /** @type {Promise<AuthShared> | null} */
  let authSharedPromise = null;
  /** @type {(() => void) | null} */
  let disposeCleanup = null;

  function shutdown() {
    disposeCleanup?.();
    disposeCleanup = null;
    closeHttpServer(server);
    server = null;
    routeHandlerPromise = null;
    authSharedPromise = null;
  }

  function loadAuthShared() {
    authSharedPromise ??= runnerImport(
      path.join(projectRoot, 'src/lib/server/admin/auth-shared.ts'),
      {
        root: projectRoot,
        cacheDir: path.join(
          projectRoot,
          'node_modules/.vite/local-content-proxy',
        ),
      },
    ).then(({ module }) => /** @type {AuthShared} */ (module));
    return authSharedPromise;
  }

  return {
    name: 'local-content-admin-dev-proxy',
    configureServer(viteServer) {
      if (
        viteServer.config.command !== 'serve' ||
        viteServer.config.mode !== 'development'
      ) {
        return;
      }

      const envDir = path.dirname(
        viteServer.config.configFile ??
          path.join(projectRoot, 'astro.config.mjs'),
      );
      const runtimeEnv = {
        ...loadEnv(viteServer.config.mode, envDir, ''),
        ...process.env,
      };
      if (runtimeEnv.CONTENT_WRITE_MODE !== 'local') return;

      shutdown();
      const proxyPort = parsePort(
        runtimeEnv.LOCAL_CONTENT_PROXY_PORT ?? DEFAULT_PROXY_PORT,
      );
      server = http.createServer(async (incoming, outgoing) => {
        try {
          const contentLength = Number(incoming.headers['content-length'] ?? 0);
          if (contentLength > MAX_REQUEST_BYTES) {
            await sendResponse(
              outgoing,
              Response.json(
                {
                  error: 'Request body is too large.',
                  code: 'payload_too_large',
                },
                { status: 413 },
              ),
            );
            return;
          }

          routeHandlerPromise ??= createRouteHandler(projectRoot);
          const [routeHandler, authShared] = await Promise.all([
            routeHandlerPromise,
            loadAuthShared(),
          ]);
          const request = await toFetchRequest(incoming, proxyPort);
          if (!(await isAdminRequest(request, runtimeEnv, authShared))) {
            await sendResponse(
              outgoing,
              Response.json(
                { error: 'Unauthorized.', code: 'unauthorized' },
                { status: 401 },
              ),
            );
            return;
          }
          if (request.method !== 'GET' && !isSameOriginRequest(request)) {
            await sendResponse(
              outgoing,
              Response.json(
                {
                  error: 'Cross-origin requests are not allowed.',
                  code: 'cross_origin',
                },
                { status: 403 },
              ),
            );
            return;
          }

          await sendResponse(outgoing, await routeHandler(request));
        } catch (error) {
          if (error instanceof RequestBodyTooLargeError) {
            await sendResponse(
              outgoing,
              Response.json(
                {
                  error: error.message,
                  code: 'payload_too_large',
                },
                { status: 413 },
              ),
            );
            return;
          }
          console.error('[local-content] Request failed', error);
          await sendResponse(
            outgoing,
            Response.json(
              {
                error: 'Local content editing failed.',
                code: 'content_unavailable',
              },
              { status: 500 },
            ),
          );
        }
      });

      server.on('error', (error) => {
        if (
          /** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE'
        ) {
          console.warn(
            `[local-content] Port ${proxyPort} is busy. Stop the previous dev server or set LOCAL_CONTENT_PROXY_PORT.`,
          );
          return;
        }
        console.error('[local-content] Proxy failed', error);
      });
      server.listen(proxyPort, '127.0.0.1', () => {
        console.info(
          `[local-content] Filesystem API listening on http://127.0.0.1:${proxyPort}`,
        );
      });
      disposeCleanup = registerDevProxyCleanup(viteServer, shutdown);
    },
    buildEnd: shutdown,
  };
}

async function createRouteHandler(projectRoot) {
  const { module } = await runnerImport(
    path.join(projectRoot, 'vite/local-content-route-handler.ts'),
    {
      root: projectRoot,
      cacheDir: path.join(
        projectRoot,
        'node_modules/.vite/local-content-proxy',
      ),
      resolve: {
        alias: {
          'cloudflare:workers': path.join(
            projectRoot,
            'vite/local-content-proxy-cloudflare-shim.mjs',
          ),
        },
      },
    },
  );
  return /** @type {{ createLocalContentRouteHandler(root: string): (request: Request) => Promise<Response> }} */ (
    module
  ).createLocalContentRouteHandler(projectRoot);
}

async function toFetchRequest(incoming, port) {
  const forwardedUrl = incoming.headers['x-original-url'];
  const url =
    typeof forwardedUrl === 'string' && /^https?:\/\//.test(forwardedUrl)
      ? forwardedUrl
      : `http://127.0.0.1:${port}${incoming.url ?? '/'}`;
  const method = incoming.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  const chunks = [];
  let byteLength = 0;
  for await (const chunk of incoming) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    byteLength += bytes.byteLength;
    if (byteLength > MAX_REQUEST_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(bytes);
  }
  const body = Buffer.concat(chunks);
  return new Request(url, {
    method,
    headers,
    body: body.length ? body : undefined,
  });
}

async function sendResponse(outgoing, response) {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key === 'content-encoding' || key === 'content-length') return;
    outgoing.setHeader(key, value);
  });
  if (!response.body) {
    outgoing.end();
    return;
  }
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

function getCookieValue(request, name) {
  const prefix = `${name}=`;
  const cookie = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}

async function isAdminRequest(request, runtimeEnv, authShared) {
  const adminToken = firstConfiguredSecret(
    runtimeEnv.ADMIN_PANEL_TOKEN,
    runtimeEnv.GUESTBOOK_ADMIN_TOKEN,
  );
  const signingSecret = firstConfiguredSecret(
    runtimeEnv.COMMUNITY_SIGNING_SECRET,
  );
  if (!adminToken || !signingSecret) return false;

  const session = await authShared.verifySession(
    getCookieValue(request, authShared.ADMIN_COOKIE),
    signingSecret,
  );
  if (!session) return false;
  return authShared.constantTimeCompare(
    session.tokenHash,
    await authShared.computeTokenHash(adminToken),
  );
}

function isSameOriginRequest(request) {
  try {
    const expectedOrigin = new URL(request.url).origin;
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const submittedOrigin =
      origin || (referer ? new URL(referer).origin : null);
    return submittedOrigin === expectedOrigin;
  } catch {
    return false;
  }
}
