import { makeGenericAPIRouteHandler } from '@keystatic/core/api/generic';
import { parseString } from 'set-cookie-parser';
import config from 'virtual:keystatic-config';

function withForwardedOrigin(request) {
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!forwardedHost) {
    return request;
  }

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const protocol =
    forwardedProto ??
    (forwardedHost.startsWith('localhost') || forwardedHost.startsWith('127.0.0.1')
      ? 'http'
      : 'https');
  const url = new URL(request.url);
  const origin = `${protocol}://${forwardedHost}`;

  if (url.origin === origin) {
    return request;
  }

  const nextUrl = new URL(`${url.pathname}${url.search}`, origin);
  return new Request(nextUrl, request);
}

function tryOrUndefined(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export const ALL = async (context) => {
  const envVarsForCf = context.locals?.runtime?.env;
  const handler = makeGenericAPIRouteHandler(
    {
      config,
      clientId:
        envVarsForCf?.KEYSTATIC_GITHUB_CLIENT_ID ??
        tryOrUndefined(() => import.meta.env.KEYSTATIC_GITHUB_CLIENT_ID),
      clientSecret:
        envVarsForCf?.KEYSTATIC_GITHUB_CLIENT_SECRET ??
        tryOrUndefined(() => import.meta.env.KEYSTATIC_GITHUB_CLIENT_SECRET),
      secret: envVarsForCf?.KEYSTATIC_SECRET ?? tryOrUndefined(() => import.meta.env.KEYSTATIC_SECRET),
    },
    {
      slugEnvName: 'PUBLIC_KEYSTATIC_GITHUB_APP_SLUG',
    }
  );

  const request = withForwardedOrigin(context.request);
  const { body, headers, status } = await handler(request);

  let headersInADifferentStructure = new Map();
  if (headers) {
    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        const lowerKey = key.toLowerCase();
        if (!headersInADifferentStructure.has(lowerKey)) {
          headersInADifferentStructure.set(lowerKey, []);
        }
        headersInADifferentStructure.get(lowerKey).push(value);
      }
    } else if (typeof headers.entries === 'function') {
      for (const [key, value] of headers.entries()) {
        headersInADifferentStructure.set(key.toLowerCase(), [value]);
      }
      if ('getSetCookie' in headers && typeof headers.getSetCookie === 'function') {
        const setCookieHeaders = headers.getSetCookie();
        if (setCookieHeaders?.length) {
          headersInADifferentStructure.set('set-cookie', setCookieHeaders);
        }
      }
    } else {
      for (const [key, value] of Object.entries(headers)) {
        headersInADifferentStructure.set(key.toLowerCase(), [value]);
      }
    }
  }

  const setCookieHeaders = headersInADifferentStructure.get('set-cookie');
  headersInADifferentStructure.delete('set-cookie');
  if (setCookieHeaders) {
    for (const setCookieValue of setCookieHeaders) {
      const { name, value, ...options } = parseString(setCookieValue);
      const sameSite = options.sameSite?.toLowerCase();
      context.cookies.set(name, value, {
        domain: options.domain,
        expires: options.expires,
        httpOnly: options.httpOnly,
        maxAge: options.maxAge,
        path: options.path,
        sameSite: sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none' ? sameSite : undefined,
      });
    }
  }

  return new Response(body, {
    status,
    headers: [...headersInADifferentStructure.entries()].flatMap(([key, val]) =>
      val.map((x) => [key, x])
    ),
  });
};

export const prerender = false;
