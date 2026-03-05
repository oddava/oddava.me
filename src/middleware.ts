import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware((context, next) => {
    if (
        context.url.pathname.includes('/github/oauth/') ||
        context.url.pathname.includes('/github/login')
    ) {
        const forwardedHost = context.request.headers.get('x-forwarded-host');
        const forwardedProto = context.request.headers.get('x-forwarded-proto') || 'https';

        if (forwardedHost) {
            const newUrl = new URL(context.url);
            newUrl.hostname = forwardedHost;
            newUrl.protocol = forwardedProto;
            newUrl.port = '';

            return next(
                new Request(newUrl.toString(), {
                    method: context.request.method,
                    headers: context.request.headers,
                    body: context.request.body,
                })
            );
        }
    }

    return next();
});
