import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The content mutation lock, from the reader's side.
 *
 * `notes:migrate` holds this lock for its entire run. While it is held,
 * `readStableContentVersion` returns null, so a cold isolate has no snapshot to
 * build from and no cache to fall back on. That state is a migration in
 * progress — the exact thing the guard exists to describe — and it must reach
 * the visitor as 503, not as a 500 from a bare `throw`.
 */

const runtime = vi.hoisted(() => ({
  version: null as string | null,
  files: [] as { sourceId: string; content: string; updatedAt: string }[],
  versionError: null as Error | null,
}));

vi.mock('../src/lib/server/content/redis-store', () => ({
  readRedisNoteFiles: async () => structuredClone(runtime.files),
  // null is precisely "a mutation holds the lock" — see the STABLE_VERSION_SCRIPT.
  readStableContentVersion: async () => {
    if (runtime.versionError) throw runtime.versionError;
    return runtime.version;
  },
}));

describe('a cold read while the mutation lock is held', () => {
  beforeEach(() => {
    process.env.CONTENT_WRITE_MODE = 'redis';
    runtime.version = null;
    runtime.versionError = null;
    runtime.files = [
      { sourceId: 'index', content: '# notes\n\nHome.', updatedAt: 't0' },
    ];
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers 503, not 500', async () => {
    const { getGardenIndexOrUnavailable } = await import('../src/lib/garden');

    // No cached index: this module was just re-imported, so the isolate is cold.
    const pending = getGardenIndexOrUnavailable();
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the garden to be unavailable');
    expect(result.response.status).toBe(503);
    expect(result.response.headers.get('Retry-After')).toBe('5');
  });

  it('serves the cached index instead, once the isolate is warm', async () => {
    const garden = await import('../src/lib/garden');

    runtime.version = '7';
    expect((await garden.getGardenIndex()).root.id).toBe('index');

    // The lock is taken after the index was built and cached. A warm isolate
    // must not 503 — stale-but-coherent beats unavailable.
    runtime.version = null;
    const result = await garden.getGardenIndexOrUnavailable();

    expect(result.ok).toBe(true);
  });

  it('still lets a real failure through as a failure', async () => {
    // The 503 is for a busy store only. Widening it would launder actual bugs.
    runtime.versionError = new Error('redis exploded');
    const garden = await import('../src/lib/garden');

    await expect(garden.getGardenIndexOrUnavailable()).rejects.toThrow(
      'redis exploded',
    );
  });
});

describe('the lock is one lock', () => {
  it('has the same key and TTL in the app and in the sync scripts', async () => {
    // The scripts run under bare `node` and cannot import the .ts, so the
    // constants are duplicated by necessity. This is what keeps the duplicate
    // honest: a divergent TTL is how a migration silently loses its barrier.
    const store = await vi.importActual<
      typeof import('../src/lib/server/content/redis-store')
    >('../src/lib/server/content/redis-store');
    const scripts = await import('../scripts/lib/redis-content.mjs');

    expect(scripts.MUTATION_LOCK_KEY).toBe(store.MUTATION_LOCK_KEY);
    expect(scripts.LOCK_TTL_MS).toBe(store.MUTATION_LOCK_TTL_MS);
  });

  it('is held long enough to outlast a whole migration run', async () => {
    // Nothing bounds a compound mutation's total duration: each Redis command
    // has its own 15s timeout and there is no budget across them. A TTL under a
    // minute could expire mid-operation and admit a second writer.
    const { MUTATION_LOCK_TTL_MS } = await vi.importActual<
      typeof import('../src/lib/server/content/redis-store')
    >('../src/lib/server/content/redis-store');

    expect(MUTATION_LOCK_TTL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});
