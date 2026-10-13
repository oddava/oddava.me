import { describe, expect, it } from 'vitest';
import { contentStoreErrorResponse } from '../src/lib/server/content/http';
import { ContentMutationBusyError } from '../src/lib/server/content/redis-store';

describe('contentStoreErrorResponse', () => {
  it('answers a held mutation lock with a retryable 503', async () => {
    const response = contentStoreErrorResponse(new ContentMutationBusyError());

    expect(response?.status).toBe(503);
    expect(response?.headers.get('Retry-After')).toBe('1');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    await expect(response?.json()).resolves.toMatchObject({
      code: 'content_busy',
    });
  });

  it('answers an unreachable store as unavailable, not unconfigured', async () => {
    const response = contentStoreErrorResponse(new Error('fetch failed'));

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: 'Studio could not reach its content store. Try again shortly.',
      code: 'content_store_unavailable',
    });
  });

  it('leaves every other failure to the caller', () => {
    expect(contentStoreErrorResponse(new Error('bug'))).toBeNull();
  });
});
