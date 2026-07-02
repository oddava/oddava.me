import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/**
 * Serves Keystatic's local-storage API from Node.js during `astro dev`.
 *
 * The Cloudflare adapter runs API routes inside workerd, where `storage:
 * { kind: 'local' }` cannot read the real project tree. This middleware
 * intercepts `/api/keystatic/*` before workerd and delegates to the Node
 * implementation with full filesystem access.
 *
 * @param {string} projectRoot
 * @returns {import('vite').Plugin}
 */
export function keystaticLocalDevProxy(projectRoot) {
  /** @type {Promise<(request: Request) => Promise<{ body: BodyInit | null; headers?: HeadersInit; status: number }>> | null} */
  let routeHandlerPromise = null;

  return {
    name: 'keystatic-local-dev-proxy',
    configureServer(server) {
      if (server.config.command !== 'serve') return;
      if (server.config.mode !== 'development') return;

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/keystatic')) {
          next();
          return;
        }

        try {
          if (!routeHandlerPromise) {
            routeHandlerPromise = createRouteHandler(projectRoot);
          }

          const routeHandler = await routeHandlerPromise;

          const request = await toFetchRequest(req, server);
          const { body, headers, status } = await routeHandler(request);

          res.statusCode = status;
          applyHeaders(res, headers);

          if (body === null || body === undefined) {
            res.end();
            return;
          }

          if (typeof body === 'string') {
            res.end(body);
            return;
          }

          if (body instanceof Uint8Array) {
            res.end(Buffer.from(body));
            return;
          }

          const buffer = Buffer.from(await new Response(body).arrayBuffer());
          res.end(buffer);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
}

/** @param {string} projectRoot */
async function createRouteHandler(projectRoot) {
  const [config, { makeGenericAPIRouteHandler }] = await Promise.all([
    loadKeystaticConfig(projectRoot),
    importNodeGenericApi(),
  ]);

  return makeGenericAPIRouteHandler(
    { config, localBaseDirectory: projectRoot },
    { slugEnvName: 'PUBLIC_KEYSTATIC_GITHUB_APP_SLUG' },
  );
}

/** @param {string} projectRoot */
async function loadKeystaticConfig(projectRoot) {
  const configPath = path.resolve(projectRoot, 'keystatic.config.ts');
  const bundled = await build({
    entryPoints: [configPath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    define: {
      'import.meta.env.PROD': 'false',
      'import.meta.env.DEV': 'true',
      'import.meta.env.MODE': '"development"',
    },
  });

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
  const module = await import(moduleUrl);
  return module.default;
}

async function importNodeGenericApi() {
  const req = createRequire(import.meta.url);
  const pkgPath = req.resolve('@keystatic/core/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const entry = pkg.exports?.['./api/generic']?.node?.default;
  if (!entry) {
    throw new Error('Could not resolve @keystatic/core/api/generic node entry.');
  }
  return import(pathToFileURL(path.resolve(path.dirname(pkgPath), entry)).href);
}

/** @param {import('http').IncomingMessage} req @param {import('vite').ViteDevServer} server */
async function toFetchRequest(req, server) {
  const protocol = 'http';
  const host = req.headers.host ?? `localhost:${server.config.server.port}`;
  const url = `${protocol}://${host}${req.url ?? '/'}`;
  const method = req.method ?? 'GET';
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }
    headers.set(key, value);
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

/** @param {import('http').ServerResponse} res @param {HeadersInit | undefined} headers */
function applyHeaders(res, headers) {
  if (!headers) return;

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      res.appendHeader(key, value);
    }
    return;
  }

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      res.appendHeader(key, value);
    });
    return;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        res.appendHeader(key, entry);
      }
      continue;
    }
    res.setHeader(key, value);
  }
}