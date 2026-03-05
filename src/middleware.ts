import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware((context, next) => {
    if (context.url.pathname.startsWith('/api/keystatic')) {
        const forwardedHost = context.request.headers.get('x-forwarded-host');
        const forwardedProto =
            context.request.headers.get('x-forwarded-proto') || 'https';

        if (forwardedHost) {
            const newUrl = new URL(context.url.pathname + context.url.search, `${forwardedProto}://${forwardedHost}`);

            return next(
                new Request(newUrl.toString(), context.request)
            );
        }
    }

    return next();
});
