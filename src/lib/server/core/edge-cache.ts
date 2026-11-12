/** The slice of Cloudflare's Cache API this module uses. */
interface EdgeCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

export type WaitUntil = (promise: Promise<unknown>) => void;

/** `caches.default` on Workers; absent under Node, where this is a no-op. */
function defaultCache(): EdgeCache | null {
  const storage = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return storage?.default ?? null;
}

/**
 * Serves `key` from this data center's cache, or produces the response and
 * stores it there for next time.
 *
 * Cloudflare does not cache what a Worker returns on its own — a `public,
 * immutable` header reaches browsers, but every cold visitor still runs the
 * Worker. Only content-addressed responses belong here: `key` must change
 * whenever the bytes would. Only a 200 is stored, and storing happens after the
 * response is sent; a cache failure never fails the request.
 */
export async function withEdgeCache(
  key: string,
  waitUntil: WaitUntil | undefined,
  produce: () => Promise<Response>,
): Promise<Response> {
  const cache = defaultCache();
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return hit;
  }

  const response = await produce();
  if (cache && waitUntil && response.status === 200) {
    waitUntil(
      cache.put(key, response.clone()).catch((error: unknown) => {
        console.warn('[edge-cache] put failed', error);
      }),
    );
  }
  return response;
}

/**
 * Serves a live public read from this data center's cache for up to
 * `seconds`, for reads that every visitor shares and that may be a little
 * stale: one Redis read per colo per window instead of one per visitor.
 *
 * The key carries the time window, so an entry is never served past it
 * whatever the cache does with headers. The stored copy says `max-age` so
 * the cache lets it go; what the browser gets keeps the producer's headers.
 */
export async function withBriefEdgeCache(
  key: string,
  seconds: number,
  waitUntil: WaitUntil | undefined,
  produce: () => Promise<Response>,
): Promise<Response> {
  const cache = defaultCache();
  const slot = Math.floor(Date.now() / (seconds * 1000));
  const windowKey = `${key}${key.includes('?') ? '&' : '?'}__window=${slot}`;
  if (cache) {
    const hit = await cache.match(windowKey).catch(() => undefined);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(hit.body, { status: hit.status, headers });
    }
  }

  const response = await produce();
  if (cache && waitUntil && response.status === 200) {
    const stored = new Response(response.clone().body, response);
    stored.headers.set('Cache-Control', `public, max-age=${seconds}`);
    waitUntil(
      cache.put(windowKey, stored).catch((error: unknown) => {
        console.warn('[edge-cache] put failed', error);
      }),
    );
  }
  return response;
}
