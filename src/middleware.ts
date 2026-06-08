import { defineMiddleware } from 'astro:middleware';

const BASE_SECURITY_HEADERS = {
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

export const onRequest = defineMiddleware(async ({ request }, next) => {
  const response = await next();
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }

  if (new URL(request.url).protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const pathname = new URL(request.url).pathname;
  if (
    !pathname.startsWith('/admin') &&
    !pathname.startsWith('/keystatic') &&
    !pathname.startsWith('/api')
  ) {
    headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self' https://challenges.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "frame-src https://challenges.cloudflare.com",
        "img-src 'self' data: https:",
        "object-src 'none'",
        "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      ].join('; '),
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
