import { afterEach, describe, expect, it, vi } from 'vitest';
import { withEdgeCache } from '../src/lib/server/core/edge-cache';

function installCache() {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string) => store.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      store.set(key, response);
    }),
  };
  vi.stubGlobal('caches', { default: cache });
  return cache;
}

describe('withEdgeCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes straight through where there is no Cache API', async () => {
    const produce = vi.fn(async () => new Response('bytes'));
    const response = await withEdgeCache('https://x/a', undefined, produce);

    expect(await response.text()).toBe('bytes');
    expect(produce).toHaveBeenCalledOnce();
  });

  it('stores a 200 after responding and serves the next request from cache', async () => {
    const cache = installCache();
    const pending: Promise<unknown>[] = [];
    const waitUntil = (promise: Promise<unknown>) => pending.push(promise);
    const produce = vi.fn(async () => new Response('bytes'));

    expect(
      await (await withEdgeCache('https://x/a', waitUntil, produce)).text(),
    ).toBe('bytes');
    await Promise.all(pending);
    expect(
      await (await withEdgeCache('https://x/a', waitUntil, produce)).text(),
    ).toBe('bytes');

    expect(produce).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('never stores a failure or a redirect', async () => {
    const cache = installCache();
    const waitUntil = vi.fn();

    for (const status of [302, 404, 503]) {
      await withEdgeCache('https://x/a', waitUntil, async () =>
        status === 302
          ? Response.redirect('https://x/default.png', 302)
          : new Response(null, { status }),
      );
    }

    expect(cache.put).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('answers from the producer when the cache itself fails', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: async () => {
          throw new Error('cache down');
        },
        put: async () => {
          throw new Error('cache down');
        },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pending: Promise<unknown>[] = [];

    const response = await withEdgeCache(
      'https://x/a',
      (promise) => pending.push(promise),
      async () => new Response('bytes'),
    );
    await Promise.all(pending);

    expect(await response.text()).toBe('bytes');
    expect(warn).toHaveBeenCalledOnce();
  });
});
