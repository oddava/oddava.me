const BASE_SECURITY_HEADERS = {
  'Permissions-Policy':
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://challenges.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'frame-src https://challenges.cloudflare.com',
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
].join('; ');

const CSP_EXCLUDED_PATH_PREFIXES = ['/admin', '/keystatic', '/api'];
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

export function shouldApplyContentSecurityPolicy(pathname: string): boolean {
  return !CSP_EXCLUDED_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

export function applySecurityHeaders(
  response: Response,
  requestUrl: string | URL,
): Response {
  const url = new URL(requestUrl);
  const headers = response.headers;

  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }

  if (url.protocol === 'https:') {
    headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY);
  }

  if (shouldApplyContentSecurityPolicy(url.pathname)) {
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  }

  return response;
}
