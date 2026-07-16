import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAdminOverview,
  updateGuestbookEntryStatus,
} from '../src/components/admin/api';

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

describe('admin API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests JSON from admin endpoints', async () => {
    const fetchMock = mockFetch(
      Response.json({
        metrics: {
          approvedGuestbook: 0,
          notes: 7,
          pendingGuestbook: 0,
        },
      }),
    );

    const overview = await fetchAdminOverview();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
    expect(init.cache).toBe('no-store');
    expect(overview.metrics.notes).toBe(7);
  });

  it('preserves mutation headers while adding JSON accept headers', async () => {
    const fetchMock = mockFetch(Response.json({ entries: [] }));

    await updateGuestbookEntryStatus('entry-1', 'approved');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('uses server error messages from JSON failures', async () => {
    mockFetch(
      Response.json(
        { error: 'Session expired.' },
        {
          status: 401,
        },
      ),
    );

    await expect(fetchAdminOverview()).rejects.toThrow('Session expired.');
  });

  it('rejects successful non-JSON responses', async () => {
    mockFetch(
      new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html' },
        status: 200,
      }),
    );

    await expect(fetchAdminOverview()).rejects.toThrow(
      'Admin API returned an invalid response (HTTP 200).',
    );
  });

  // A crashed route answers with an HTML error page rather than JSON, so the
  // status is the only diagnosis left to report.
  it('reports the status when an error response is not JSON', async () => {
    mockFetch(
      new Response('<!doctype html><title>Error</title>', {
        headers: { 'Content-Type': 'text/html' },
        status: 500,
      }),
    );

    await expect(fetchAdminOverview()).rejects.toThrow(
      'Admin API returned an invalid response (HTTP 500).',
    );
  });

  // `AbortSignal.timeout` rejects with a DOMException whose message is the
  // literal "signal timed out" — a browser internal that must never reach the
  // operator as if it were advice.
  it('normalizes fetch timeouts into an actionable message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('signal timed out', 'TimeoutError'),
    );

    await expect(fetchAdminOverview()).rejects.toThrow(
      'The admin API did not respond in time.',
    );
  });

  it('normalizes network failures into an actionable message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );

    await expect(fetchAdminOverview()).rejects.toThrow(
      'Could not reach the admin API.',
    );
  });
});
