import { describe, expect, it } from 'vitest';
import { withAdminSecurityHeaders } from '../src/lib/server/admin';
import { json } from '../src/lib/server/community';

describe('server admin helpers', () => {
  it('hardens admin responses without changing payload or status', async () => {
    const response = withAdminSecurityHeaders(
      json(
        { ok: true },
        {
          status: 202,
          headers: {
            'Cache-Control': 'public, max-age=60',
            'X-Trace': 'test',
          },
        },
      ),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Trace')).toBe('test');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
