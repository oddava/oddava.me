import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applySecurityHeaders,
  shouldApplyContentSecurityPolicy,
} from '../src/lib/server/security-headers';

describe('security header middleware helpers', () => {
  it('applies baseline security headers and CSP to public HTTPS pages', async () => {
    const response = applySecurityHeaders(
      new Response('ok', { status: 203 }),
      'https://oddava.me/blog',
    );

    expect(response.status).toBe(203);
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(response.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "frame-ancestors 'none'",
    );
    await expect(response.text()).resolves.toBe('ok');
  });

  it('keeps prerendered asset headers aligned with Worker responses', () => {
    const staticHeaders = readFileSync(
      new URL('../public/_headers', import.meta.url),
      'utf8',
    );
    const response = applySecurityHeaders(new Response(), 'https://oddava.me/');

    for (const name of [
      'Content-Security-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      'Permissions-Policy',
      'Referrer-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ]) {
      expect(staticHeaders).toContain(`${name}: ${response.headers.get(name)}`);
    }
  });

  it('preserves existing baseline headers and protects admin pages with CSP', () => {
    const response = applySecurityHeaders(
      new Response(null, {
        headers: {
          'X-Frame-Options': 'DENY',
        },
      }),
      'http://oddava.me/admin',
    );

    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.has('Strict-Transport-Security')).toBe(false);
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('skips CSP for API responses', () => {
    const response = applySecurityHeaders(
      new Response('{"ok":true}', {
        headers: { 'Content-Type': 'application/json' },
      }),
      'https://oddava.me/api/guestbook',
    );

    expect(response.headers.has('Content-Security-Policy')).toBe(false);
  });

  it('keeps the CSP route rule explicit', () => {
    expect(shouldApplyContentSecurityPolicy('/')).toBe(true);
    expect(shouldApplyContentSecurityPolicy('/about')).toBe(true);
    expect(shouldApplyContentSecurityPolicy('/api/spotify')).toBe(false);
    expect(shouldApplyContentSecurityPolicy('/api/guestbook')).toBe(false);
    expect(shouldApplyContentSecurityPolicy('/admin')).toBe(true);
    expect(shouldApplyContentSecurityPolicy('/admin/login')).toBe(true);
    expect(shouldApplyContentSecurityPolicy('/apian')).toBe(true);
  });

  it('omits report-to directive when CSP_REPORT_ENDPOINT is unset', () => {
    const previous = process.env.CSP_REPORT_ENDPOINT;
    delete process.env.CSP_REPORT_ENDPOINT;
    try {
      const response = applySecurityHeaders(
        new Response('ok'),
        'https://oddava.me/blog',
      );
      const csp = response.headers.get('Content-Security-Policy') ?? '';
      expect(csp).not.toContain('report-to');
    } finally {
      if (previous !== undefined) process.env.CSP_REPORT_ENDPOINT = previous;
    }
  });

  it('adds report-to directive when CSP_REPORT_ENDPOINT is set', () => {
    const previous = process.env.CSP_REPORT_ENDPOINT;
    process.env.CSP_REPORT_ENDPOINT = 'my-endpoint';
    try {
      const response = applySecurityHeaders(
        new Response('ok'),
        'https://oddava.me/blog',
      );
      const csp = response.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain('report-to my-endpoint');
    } finally {
      if (previous !== undefined) process.env.CSP_REPORT_ENDPOINT = previous;
      else delete process.env.CSP_REPORT_ENDPOINT;
    }
  });
});
