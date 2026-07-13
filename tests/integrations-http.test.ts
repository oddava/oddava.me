import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationError } from '../src/lib/server/integrations/errors';
import {
  integrationFetch,
  integrationFetchJson,
} from '../src/lib/server/integrations/http';

const OPTIONS = { label: 'Test API' } as const;

function response(status: number, body = '', headers: HeadersInit = {}) {
  // 204 is required by spec to carry no body.
  return new Response(status === 204 ? null : body, { status, headers });
}

/** Asserts the request failed, and narrows to the error the caller inspects. */
async function failure(request: Promise<Response>): Promise<IntegrationError> {
  try {
    await request;
  } catch (error) {
    return error as IntegrationError;
  }
  throw new Error('Expected the request to fail, but it resolved.');
}

describe('integration HTTP layer', () => {
  beforeEach(() => {
    // Full-jitter backoff is randomized; pin it so retries do not add real delay.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the first successful response without retrying', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(200, '{}'));

    const result = await integrationFetch('https://api.test/x', OPTIONS);

    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('treats 204 as success rather than an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(204));

    const result = await integrationFetch('https://api.test/x', OPTIONS);

    expect(result.status).toBe(204);
  });

  it('retries a 5xx and succeeds on a later attempt', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, '{}'));

    const result = await integrationFetch('https://api.test/x', OPTIONS);

    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries a network fault', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response(200, '{}'));

    await expect(
      integrationFetch('https://api.test/x', OPTIONS),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget and reports the last failure', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(503, 'upstream down'));

    const error = await failure(
      integrationFetch('https://api.test/x', { ...OPTIONS, attempts: 3 }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.code).toBe('upstream_unavailable');
    expect(error.retryable).toBe(true);
  });

  it('does not retry a credential failure', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(401, 'bad token'));

    const error = await failure(
      integrationFetch('https://api.test/x', OPTIONS),
    );

    // Retrying a 401 with the same credentials can only ever fail again.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('invalid_credentials');
    expect(error.retryable).toBe(false);
    expect(error.requiresOperatorAction).toBe(true);
  });

  it('does not retry other non-transient 4xx responses', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(400, 'bad request'));

    const error = await failure(
      integrationFetch('https://api.test/x', OPTIONS),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('unknown');
    expect(error.retryable).toBe(false);
  });

  it('retries a rate limit whose Retry-After is short', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(429, '', { 'Retry-After': '1' }))
      .mockResolvedValueOnce(response(200, '{}'));

    await expect(
      integrationFetch('https://api.test/x', OPTIONS),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('surfaces a long rate limit instead of sleeping through it', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(429, '', { 'Retry-After': '3600' }));

    const error = await failure(
      integrationFetch('https://api.test/x', OPTIONS),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(3600);
    expect(error.message).toContain('retry in 3600s');
  });

  it('parses an HTTP-date Retry-After', async () => {
    const future = new Date(Date.now() + 7200_000).toUTCString();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(429, '', { 'Retry-After': future }),
    );

    const error = await failure(
      integrationFetch('https://api.test/x', OPTIONS),
    );

    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBeGreaterThan(7000);
  });

  it('classifies a timeout as a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          const abort = new Error('The operation was aborted.');
          abort.name = 'AbortError';
          setTimeout(() => reject(abort), 5);
        }),
    );

    const error = await failure(
      integrationFetch('https://api.test/x', { ...OPTIONS, attempts: 1 }),
    );

    expect(error.code).toBe('network_error');
    expect(error.message).toContain('Test API');
  });

  it('rejects oversized JSON responses without buffering them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(200, '{}', { 'Content-Length': String(512 * 1024 + 1) }),
    );

    await expect(
      integrationFetchJson('https://api.test/x', OPTIONS),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
