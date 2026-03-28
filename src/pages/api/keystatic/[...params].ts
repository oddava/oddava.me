import { makeHandler } from '@keystatic/astro/api';
import type { APIContext } from 'astro';
import config from '../../../../keystatic.config';

const handler = makeHandler({ config });

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function parseOrigin(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function preferredOrigin(request: Request): URL | null {
  const configuredOrigin = import.meta.env.KEYSTATIC_PUBLIC_ORIGIN?.trim();
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));

  if (configuredOrigin) {
    return parseOrigin(configuredOrigin);
  }

  if (!forwardedHost) {
    return null;
  }

  const proto = (forwardedProto ?? 'https').toLowerCase();
  return parseOrigin(`${proto === 'http' ? 'http' : 'https'}://${forwardedHost}`);
}

function normalizeRequestOrigin(request: Request): Request {
  const targetOrigin = preferredOrigin(request);

  if (!targetOrigin) {
    return request;
  }

  const originalUrl = new URL(request.url);
  if (targetOrigin.origin === originalUrl.origin) {
    return request;
  }

  const rewritten = new URL(request.url);
  rewritten.protocol = targetOrigin.protocol;
  rewritten.host = targetOrigin.host;

  return new Request(rewritten.toString(), request);
}

async function all(context: APIContext): Promise<Response> {
  const rewrittenRequest = normalizeRequestOrigin(context.request);

  if (rewrittenRequest === context.request) {
    return handler(context);
  }

  return handler({ ...context, request: rewrittenRequest });
}

export { all, all as ALL };
export const prerender = false;
