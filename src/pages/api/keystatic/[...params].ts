import { makeHandler } from '@keystatic/astro/api';
import type { APIContext } from 'astro';
import config from '../../../../keystatic.config';

const handler = makeHandler({ config });

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function normalizeRequestOrigin(request: Request): Request {
  const configuredOrigin = import.meta.env.KEYSTATIC_PUBLIC_ORIGIN;
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));

  const originalUrl = new URL(request.url);

  if (configuredOrigin) {
    const target = new URL(configuredOrigin);

    if (target.origin !== originalUrl.origin) {
      const rewritten = new URL(request.url);
      rewritten.protocol = target.protocol;
      rewritten.host = target.host;
      return new Request(rewritten.toString(), request);
    }

    return request;
  }

  if (!forwardedHost) {
    return request;
  }

  const normalizedProto = (forwardedProto ?? originalUrl.protocol.replace(':', '')).toLowerCase();
  const rewritten = new URL(request.url);
  rewritten.protocol = normalizedProto === 'http' ? 'http:' : 'https:';
  rewritten.host = forwardedHost;

  if (rewritten.origin === originalUrl.origin) {
    return request;
  }

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
