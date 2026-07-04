import { getServerEnv } from './env';

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
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'frame-src https://challenges.cloudflare.com',
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
];

// Only the admin UI is exempt from CSP. API responses are JSON and carry no
// inline scripts, so the full policy is safe to apply there. Keeping CSP on
// /api/* hardens against reflected-content injection in error handlers.
const CSP_EXCLUDED_PATH_PREFIXES = ['/admin'];
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

export function shouldApplyContentSecurityPolicy(pathname: string): boolean {
  return !CSP_EXCLUDED_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

function buildContentSecurityPolicy(): string {
  const directives = [...CONTENT_SECURITY_POLICY];
  // `report-to` is only meaningful when a reporting endpoint group is
  // configured. The Reporting-Endpoints header itself is set by the
  // deployment operator; here we only wire the CSP directive.
  const reportEndpoint = getServerEnv('CSP_REPORT_ENDPOINT');
  if (reportEndpoint) {
    directives.push(`report-to ${reportEndpoint}`);
  }
  return directives.join('; ');
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
    headers.set('Content-Security-Policy', buildContentSecurityPolicy());
  }

  return response;
}
