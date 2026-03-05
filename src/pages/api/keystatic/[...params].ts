// @ts-nocheck
import { makeGenericAPIRouteHandler } from '@keystatic/core/api/generic';
import { parseString } from 'set-cookie-parser';
import keystaticConfig from 'virtual:keystatic-config';

export const prerender = false;

function tryOrUndefined(fn: () => string | undefined) {
    try {
        return fn();
    } catch {
        return undefined;
    }
}

const _handler = makeGenericAPIRouteHandler({
    config: keystaticConfig,
    clientId:
        tryOrUndefined(() => import.meta.env.KEYSTATIC_GITHUB_CLIENT_ID) ??
        undefined,
    clientSecret:
        tryOrUndefined(() => import.meta.env.KEYSTATIC_GITHUB_CLIENT_SECRET) ??
        undefined,
    secret:
        tryOrUndefined(() => import.meta.env.KEYSTATIC_SECRET) ?? undefined,
});

function fixRequestUrl(request: Request): Request {
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto =
        request.headers.get('x-forwarded-proto') || 'https';

    if (forwardedHost) {
        const originalUrl = new URL(request.url);
        const fixedUrl = new URL(
            originalUrl.pathname + originalUrl.search,
            `${forwardedProto}://${forwardedHost}`
        );
        return new Request(fixedUrl.toString(), request);
    }

    return request;
}

export const ALL: import('astro').APIRoute = async (context) => {
    const fixedRequest = fixRequestUrl(context.request);
    const { body, headers, status } = await _handler(fixedRequest);

    let headersMap = new Map<string, string[]>();
    if (headers) {
        if (Array.isArray(headers)) {
            for (const [key, value] of headers) {
                if (!headersMap.has(key.toLowerCase())) {
                    headersMap.set(key.toLowerCase(), []);
                }
                headersMap.get(key.toLowerCase())!.push(value);
            }
        }
    }

    const setCookieHeaders = headersMap.get('set-cookie');
    headersMap.delete('set-cookie');

    if (setCookieHeaders) {
        for (const setCookieValue of setCookieHeaders) {
            const { name, value, ...options } = parseString(setCookieValue);
            const sameSite = options.sameSite?.toString().toLowerCase();
            context.cookies.set(name, value, {
                domain: options.domain,
                expires: options.expires,
                httpOnly: options.httpOnly,
                maxAge: options.maxAge,
                path: options.path,
                sameSite:
                    sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none'
                        ? sameSite
                        : undefined,
            });
        }
    }

    return new Response(body, {
        status,
        headers: [...headersMap.entries()].flatMap(
            ([key, val]) => val.map((x) => [key, x])
        ),
    });
};
