import http from 'node:http';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { loadEnv, runnerImport } from 'vite';

// The admin cookie name and session TTL live in
// `src/lib/server/admin/auth-shared.ts` so the Worker path (`auth.ts`) and
// this Node dev proxy stay in sync. We import that module via Vite's
// `runnerImport` (which transpiles TS on the fly) instead of re-implementing
// HMAC/SHA-256 with `node:crypto`.
const DEFAULT_PROXY_PORT = 45556;

/**
 * Exposes a local-file content admin API from a standalone Node.js HTTP server
 * during `astro dev`.
 *
 * The Cloudflare adapter runs Astro API routes in workerd, where repository
 * file writes are unavailable. Because workerd's fetch pipeline bypasses
 * Vite's `server.middlewares`, this plugin spawns its own HTTP server
 * (listening on 127.0.0.1) and `src/lib/server/content/route.ts` forwards
 * admin content requests to it when `CONTENT_WRITE_MODE=local`.
 *
 * Env vars are loaded from `.env` via Vite's `loadEnv` (empty prefix, so
 * non-`VITE_`-prefixed vars like `CONTENT_WRITE_MODE` are picked up the same
 * way Astro exposes them to `import.meta.env`). `process.env` is layered on
 * top so explicit shell exports still win.
 *
 * @param {string} projectRoot
 * @returns {import('vite').Plugin}
 */
export function localContentAdminDevProxy(projectRoot) {
  /** @type {http.Server | null} */
  let server = null;
  /** @type {Promise<(request: Request) => Promise<Response>> | null} */
  let routeHandlerPromise = null;
  /** @type {Promise<any> | null} */
  let authSharedPromise = null;

  /**
   * Load the shared admin-auth TS module via Vite so it is transpiled into
   * Node-runnable code. Cached for the lifetime of the dev server.
   * @returns {Promise<any>}
   */
  function loadAuthShared() {
    if (!authSharedPromise) {
      authSharedPromise = runnerImport(
        path.join(projectRoot, 'src/lib/server/admin/auth-shared.ts'),
        {
          root: projectRoot,
          cacheDir: path.join(
            projectRoot,
            'node_modules/.vite/local-content-proxy',
          ),
        },
      ).then(({ module }) => module);
    }
    return authSharedPromise;
  }

  return {
    name: 'local-content-admin-dev-proxy',
    configureServer(viteServer) {
      if (viteServer.config.command !== 'serve') return;
      if (viteServer.config.mode !== 'development') return;
      const envDir = path.dirname(
        viteServer.config.configFile ??
          path.join(projectRoot, 'astro.config.mjs'),
      );
      const env = {
        ...loadEnv(viteServer.config.mode, envDir, ''),
        ...process.env,
      };
      if (env.CONTENT_WRITE_MODE !== 'local') return;

      const proxyPort = Number(
        env.LOCAL_CONTENT_PROXY_PORT ?? DEFAULT_PROXY_PORT,
      );

      server = http.createServer(async (req, res) => {
        try {
          if (!routeHandlerPromise) {
            routeHandlerPromise = createRouteHandler(projectRoot);
          }
          const [routeHandler, authShared] = await Promise.all([
            routeHandlerPromise,
            loadAuthShared(),
          ]);
          const request = await toFetchRequest(req, proxyPort);
          if (!(await isAdminRequest(request, env, authShared))) {
            sendResponse(
              res,
              Response.json(
                { error: 'Unauthorized.', code: 'unauthorized' },
                { status: 401 },
              ),
            );
            return;
          }

          const original = req.headers['x-original-url'];
          if (typeof original === 'string') {
            const rewritten = new URL(original);
            Object.defineProperty(request, 'url', {
              value: rewritten.toString(),
              configurable: true,
            });
          }

          if (request.method !== 'GET' && !isSameOriginRequest(request)) {
            sendResponse(
              res,
              Response.json(
                { error: 'Cross-origin requests are not allowed.' },
                { status: 403 },
              ),
            );
            return;
          }

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

      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.warn(
            `[local-content] Port ${proxyPort} is busy; set LOCAL_CONTENT_PROXY_PORT to use another port.`,
          );
          return;
        }
        throw error;
      });

      server.listen(proxyPort, '127.0.0.1', () => {
        console.info(
          `[local-content] Dev proxy listening on http://127.0.0.1:${proxyPort}`,
        );
      });
    },
    buildEnd() {
      server?.close();
      server = null;
      routeHandlerPromise = null;
      authSharedPromise = null;
    },
  };
}

async function createRouteHandler(projectRoot) {
  const runnerConfig = {
    root: projectRoot,
    cacheDir: path.join(projectRoot, 'node_modules/.vite/local-content-proxy'),
    resolve: {
      alias: {
        'cloudflare:workers': path.join(
          projectRoot,
          'vite/local-content-proxy-cloudflare-shim.mjs',
        ),
      },
    },
  };

  const { module } = await runnerImport(
    path.join(projectRoot, 'vite/local-content-route-handler.ts'),
    runnerConfig,
  );

  return module.createLocalContentRouteHandler(projectRoot);
}

async function toFetchRequest(req, port) {
  const url = `http://127.0.0.1:${port}${req.url ?? '/'}`;
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
    if (key.toLowerCase() === 'content-encoding') return;
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

/**
 * Verify the admin session cookie using the shared auth module (WebCrypto
 * based, identical to the Worker path in `src/lib/server/admin/auth.ts`).
 * @param {Request} request
 * @param {Record<string, string | undefined>} env
 * @param {any} authShared
 */
async function isAdminRequest(request, env, authShared) {
  const adminToken = env.ADMIN_PANEL_TOKEN ?? env.GUESTBOOK_ADMIN_TOKEN;
  const signingSecret = env.COMMUNITY_SIGNING_SECRET;
  if (!adminToken || !signingSecret) return false;

  const session = await authShared.verifySession(
    getCookieValue(request, authShared.ADMIN_COOKIE),
    signingSecret,
  );
  if (!session) return false;

  const expectedHash = await authShared.computeTokenHash(adminToken);
  return authShared.constantTimeCompare(session.tokenHash, expectedHash);
}

function isSameOriginRequest(request) {
  const original = request.headers.get('x-original-url') ?? request.url ?? '';
  if (!original) return false;
  const expectedOrigin = new URL(original).origin;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const submittedOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!submittedOrigin) return false;
  return submittedOrigin === expectedOrigin;
}
