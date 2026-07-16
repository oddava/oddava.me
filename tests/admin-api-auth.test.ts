import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ADMIN_TOKEN = 'super-secret-admin-token';
const SIGNING_SECRET = 'test-signing-secret-with-enough-entropy';
const ORIGIN = 'https://oddava.me';
const FOREIGN_ORIGIN = 'https://evil.example';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADMIN_API_DIR = path.join(ROOT, 'src', 'pages', 'api', 'admin');

/**
 * Every route under `src/pages/api/admin`, and the two guarantees it owes.
 *
 * `auth` — rejects a request with no session cookie (401).
 * `sameOrigin` — rejects a cross-origin request that *has* a valid cookie
 *   (403). Only mutating endpoints owe this; it is the documented policy
 *   (docs/architecture.md, "Admin surface"), and GET routes deliberately skip
 *   it.
 *
 * The two flags are separate because the two mechanisms are separate:
 * `requireSecuredAdminApi` only ever sees `cookies`, so it cannot check
 * Origin — routes call `ensureSameOrigin` themselves. A route that forgets
 * that call still passes auth, which is exactly the regression this table
 * exists to catch.
 */
const ADMIN_ROUTES: {
  file: string;
  module: string;
  method: string;
  auth: boolean;
  sameOrigin: boolean;
  params?: Record<string, string>;
  why?: string;
  // For the unauthenticated exceptions: a body that should succeed with no
  // session cookie present, proving the endpoint is reachable without one.
  anonymousBody?: () => unknown;
  anonymousStatus?: number;
}[] = [
  {
    file: 'overview.ts',
    module: '../src/pages/api/admin/overview',
    method: 'GET',
    auth: true,
    sameOrigin: false,
  },
  {
    file: 'integrations/index.ts',
    module: '../src/pages/api/admin/integrations/index',
    method: 'GET',
    auth: true,
    sameOrigin: false,
  },
  {
    file: 'integrations/[id].ts',
    module: '../src/pages/api/admin/integrations/[id]',
    method: 'PATCH',
    auth: true,
    sameOrigin: true,
    params: { id: 'spotify' },
  },
  {
    file: 'integrations/[id]/credentials.ts',
    module: '../src/pages/api/admin/integrations/[id]/credentials',
    method: 'PUT',
    auth: true,
    sameOrigin: true,
    params: { id: 'spotify' },
  },
  {
    file: 'integrations/[id]/credentials.ts',
    module: '../src/pages/api/admin/integrations/[id]/credentials',
    method: 'DELETE',
    auth: true,
    sameOrigin: true,
    params: { id: 'spotify' },
  },
  {
    file: 'integrations/[id]/test.ts',
    module: '../src/pages/api/admin/integrations/[id]/test',
    method: 'POST',
    auth: true,
    sameOrigin: true,
    params: { id: 'spotify' },
  },
  {
    file: 'content/collections.ts',
    module: '../src/pages/api/admin/content/collections',
    method: 'GET',
    auth: true,
    sameOrigin: false,
  },
  {
    file: 'content/media.ts',
    module: '../src/pages/api/admin/content/media',
    method: 'POST',
    auth: true,
    sameOrigin: true,
  },
  {
    file: 'content/[collection]/index.ts',
    module: '../src/pages/api/admin/content/[collection]/index',
    method: 'GET',
    auth: true,
    sameOrigin: false,
    params: { collection: 'notes' },
  },
  {
    file: 'content/[collection]/index.ts',
    module: '../src/pages/api/admin/content/[collection]/index',
    method: 'POST',
    auth: true,
    sameOrigin: true,
    params: { collection: 'notes' },
  },
  {
    file: 'content/[collection]/[id].ts',
    module: '../src/pages/api/admin/content/[collection]/[id]',
    method: 'GET',
    auth: true,
    sameOrigin: false,
    params: { collection: 'notes', id: 'index' },
  },
  {
    file: 'content/[collection]/[id].ts',
    module: '../src/pages/api/admin/content/[collection]/[id]',
    method: 'PUT',
    auth: true,
    sameOrigin: true,
    params: { collection: 'notes', id: 'index' },
  },
  {
    file: 'content/[collection]/[id].ts',
    module: '../src/pages/api/admin/content/[collection]/[id]',
    method: 'DELETE',
    auth: true,
    sameOrigin: true,
    params: { collection: 'notes', id: 'index' },
  },
  {
    file: 'content/[collection]/folders.ts',
    module: '../src/pages/api/admin/content/[collection]/folders',
    method: 'GET',
    auth: true,
    sameOrigin: false,
    params: { collection: 'notes' },
  },
  {
    file: 'content/[collection]/folders.ts',
    module: '../src/pages/api/admin/content/[collection]/folders',
    method: 'POST',
    auth: true,
    sameOrigin: true,
    params: { collection: 'notes' },
  },
  {
    file: 'content/[collection]/folders.ts',
    module: '../src/pages/api/admin/content/[collection]/folders',
    method: 'PATCH',
    auth: true,
    sameOrigin: true,
    params: { collection: 'notes' },
  },
  {
    file: 'content/[collection]/folders.ts',
    module: '../src/pages/api/admin/content/[collection]/folders',
    method: 'DELETE',
    auth: true,
    sameOrigin: true,
    params: { collection: 'notes' },
  },
  {
    file: 'content/[collection]/move.ts',
    module: '../src/pages/api/admin/content/[collection]/move',
    method: 'POST',
    auth: true,
    sameOrigin: true,
    params: { collection: 'notes' },
  },
  {
    file: 'content/[collection]/reorder.ts',
    module: '../src/pages/api/admin/content/[collection]/reorder',
    method: 'POST',
    auth: true,
    sameOrigin: true,
    params: { collection: 'notes' },
  },
  // The two deliberate exceptions. Asserted rather than skipped, so that
  // "unauthenticated" stays a decision on the record instead of an oversight.
  {
    file: 'session.ts',
    module: '../src/pages/api/admin/session',
    method: 'POST',
    auth: false,
    sameOrigin: true,
    why: 'the login endpoint cannot require the session it is about to mint',
    anonymousBody: () => ({ token: ADMIN_TOKEN }),
    anonymousStatus: 200,
  },
  {
    file: 'logout.ts',
    module: '../src/pages/api/admin/logout',
    method: 'POST',
    auth: false,
    sameOrigin: true,
    why: 'requiring a valid session to log out would strand a bad cookie',
    anonymousBody: () => ({}),
    anonymousStatus: 302,
  },
];

async function collectRouteFiles(
  directory: string,
  prefix = '',
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(
        ...(await collectRouteFiles(
          path.join(directory, entry.name),
          relative,
        )),
      );
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      // A leading underscore is not a route in Astro — `_shared.ts` is a helper.
      if (!entry.name.startsWith('_')) files.push(relative);
    }
  }
  return files;
}

/** Just enough of AstroCookies for these handlers: get, and set for logout. */
function cookieJar(value: string | undefined) {
  const set: { name: string; value: string }[] = [];
  return {
    set,
    api: {
      get: (name: string) =>
        name === 'oddava-admin-session' && value !== undefined
          ? { value }
          : undefined,
      set: (name: string, next: string) => set.push({ name, value: next }),
      delete: (name: string) => set.push({ name, value: '' }),
    },
  };
}

function contextFor(
  route: (typeof ADMIN_ROUTES)[number],
  options: { origin: string; cookie?: string; body?: unknown },
) {
  const request = new Request(`${ORIGIN}/api/admin/probe`, {
    method: route.method,
    headers: { 'Content-Type': 'application/json', Origin: options.origin },
    // A body every mutating handler would accept if it got that far; the point
    // is that it must not get that far.
    body:
      route.method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
  });
  const jar = cookieJar(options.cookie);
  return {
    jar,
    context: {
      request,
      cookies: jar.api,
      params: route.params ?? {},
      url: new URL(request.url),
    },
  };
}

async function handlerFor(route: (typeof ADMIN_ROUTES)[number]) {
  const module = (await import(route.module)) as Record<string, unknown>;
  const handler = module[route.method];
  if (typeof handler !== 'function') {
    throw new Error(`${route.file} exports no ${route.method} handler`);
  }
  return handler as (context: unknown) => Promise<Response>;
}

describe('admin API auth matrix', () => {
  let validCookie: string;

  beforeEach(async () => {
    process.env.ADMIN_PANEL_TOKEN = ADMIN_TOKEN;
    process.env.COMMUNITY_SIGNING_SECRET = SIGNING_SECRET;
    const { createAdminSessionValue } =
      await import('../src/lib/server/admin/auth');
    validCookie = await createAdminSessionValue(ADMIN_TOKEN);
  });

  afterEach(() => {
    delete process.env.ADMIN_PANEL_TOKEN;
    delete process.env.COMMUNITY_SIGNING_SECRET;
  });

  it('covers every route file under src/pages/api/admin', async () => {
    const onDisk = (await collectRouteFiles(ADMIN_API_DIR)).toSorted();
    const inTable = [...new Set(ADMIN_ROUTES.map((r) => r.file))].toSorted();
    // A new admin route must be added here with its auth expectations. If this
    // fails, the route below it is untested, not merely unlisted.
    expect(inTable).toEqual(onDisk);
  });

  describe.each(ADMIN_ROUTES)('$method /$file', (route) => {
    if (route.auth) {
      it('rejects a request with no session cookie (401)', async () => {
        const handler = await handlerFor(route);
        const { context } = contextFor(route, {
          origin: ORIGIN,
          cookie: undefined,
        });
        expect((await handler(context)).status).toBe(401);
      });
    } else {
      it(`is reachable with no session cookie: ${route.why}`, async () => {
        // Asserting a success, not merely "not 401" — session.ts answers 401 to
        // a *bad token*, which would let a `not.toBe(401)` pass for the wrong
        // reason. Succeeding anonymously is what proves no session is required.
        const handler = await handlerFor(route);
        const { context, jar } = contextFor(route, {
          origin: ORIGIN,
          cookie: undefined,
          body: route.anonymousBody?.(),
        });
        expect((await handler(context)).status).toBe(route.anonymousStatus);
        expect(jar.set.map((entry) => entry.name)).toContain(
          'oddava-admin-session',
        );
      });
    }

    if (route.sameOrigin) {
      it('rejects a cross-origin request that carries a valid cookie (403)', async () => {
        const handler = await handlerFor(route);
        const { context } = contextFor(route, {
          origin: FOREIGN_ORIGIN,
          cookie: validCookie,
        });
        expect((await handler(context)).status).toBe(403);
      });
    }
  });
});
