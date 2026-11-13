import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGardenIndex } from '../src/lib/garden/build';

const state = vi.hoisted(() => ({
  authError: null as Response | null,
  garden: null as unknown,
}));
vi.mock('../src/lib/server/admin', () => ({
  adminJson: (data: unknown, init?: ResponseInit) => Response.json(data, init),
  requireSecuredAdminApi: async () => state.authError,
}));
vi.mock('../src/lib/garden', () => ({
  getGardenIndexOrUnavailable: async () => state.garden,
}));
import { GET } from '../src/pages/api/admin/content/connections';

const index = buildGardenIndex([
  {
    id: 'index',
    data: {},
    body: '# Home\n\nSee [[a]]. #hi',
    updatedAt: '2026-01-01',
  },
  {
    id: 'a',
    data: {},
    body: '# A\n\nBack to [[index]].',
    updatedAt: '2026-01-01',
  },
]);

const call = (query: string) =>
  GET({
    cookies: {},
    url: new URL(`https://oddava.me/api/admin/content/connections${query}`),
  } as unknown as APIContext);

describe('GET /api/admin/content/connections', () => {
  beforeEach(() => {
    state.authError = null;
    state.garden = { ok: true, index };
  });

  it('answers the admin session check first', async () => {
    state.authError = new Response('no', { status: 401 });
    expect((await call('?id=a')).status).toBe(401);
  });

  it('wants a note id', async () => {
    const response = await call('');
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_request');
  });

  it('returns the note’s links and the tag list', async () => {
    const response = await call('?id=index');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connections.id).toBe('index');
    expect(
      body.connections.backlinks.map((link: { id: string }) => link.id),
    ).toEqual(['a']);
    expect(body.tags).toEqual([{ tag: 'hi', count: 1 }]);
  });

  it('passes a not-ready garden through as a 503 with its Retry-After', async () => {
    state.garden = {
      ok: false,
      response: new Response('x', {
        status: 503,
        headers: { 'Retry-After': '5' },
      }),
    };
    const response = await call('?id=a');
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
  });
});
