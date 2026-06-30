import { describe, expect, it } from 'vitest';
import {
  firstForwardedHeaderValue,
  getKeystaticRequestOrigin,
  normalizeKeystaticRequestOrigin,
  parseOrigin,
} from '../src/lib/server/keystatic/origin';

describe('server Keystatic origin helpers', () => {
  it('parses forwarded header values conservatively', () => {
    expect(firstForwardedHeaderValue('admin.example, proxy.example')).toBe(
      'admin.example',
    );
    expect(firstForwardedHeaderValue('  ')).toBeNull();
    expect(parseOrigin('not a url')).toBeNull();
  });

  it('prefers explicit configured origin over forwarded headers', () => {
    const request = new Request('https://internal.example/keystatic', {
      headers: {
        'x-forwarded-host': 'forwarded.example',
      },
    });

    expect(
      getKeystaticRequestOrigin(request, 'https://configured.example')?.origin,
    ).toBe('https://configured.example');
  });

  it('derives a safe origin from forwarded headers', () => {
    const httpsRequest = new Request('https://internal.example/keystatic', {
      headers: {
        'x-forwarded-host': 'public.example',
      },
    });
    const httpRequest = new Request('https://internal.example/keystatic', {
      headers: {
        'x-forwarded-host': 'local.example',
        'x-forwarded-proto': 'http',
      },
    });
    const unsafeProtoRequest = new Request('https://internal.example', {
      headers: {
        'x-forwarded-host': 'public.example',
        'x-forwarded-proto': 'javascript',
      },
    });

    expect(getKeystaticRequestOrigin(httpsRequest)?.origin).toBe(
      'https://public.example',
    );
    expect(getKeystaticRequestOrigin(httpRequest)?.origin).toBe(
      'http://local.example',
    );
    expect(getKeystaticRequestOrigin(unsafeProtoRequest)?.origin).toBe(
      'https://public.example',
    );
  });

  it('rewrites only the request origin and keeps path details', () => {
    const request = new Request(
      'https://internal.example/keystatic/api?path=/posts',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ok: true }),
      },
    );

    const rewritten = normalizeKeystaticRequestOrigin(
      request,
      'https://cms.example',
    );

    expect(rewritten).not.toBe(request);
    expect(rewritten.url).toBe('https://cms.example/keystatic/api?path=/posts');
    expect(rewritten.method).toBe('POST');
    expect(rewritten.headers.get('content-type')).toBe('application/json');
  });
});
