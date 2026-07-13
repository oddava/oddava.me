import { getServerEnv } from './env';

const BASE_SECURITY_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'browsing-topics=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

// `frame-ancestors` is ignored in a CSP <meta> element, so this directive
// remains an HTTP header. Astro owns the remaining policy and generates the
// per-page hashes required by island bootstrap scripts and component styles.
const CONTENT_SECURITY_POLICY = ["frame-ancestors 'none'"];

const CSP_EXCLUDED_PATH_PREFIXES = ['/api'];
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export function shouldApplyContentSecurityPolicy(pathname: string): boolean {
  return !CSP_EXCLUDED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function buildContentSecurityPolicy(): string {
  const directives = [...CONTENT_SECURITY_POLICY];
  // `report-to` is only meaningful when a reporting endpoint group is
  // configured. The Reporting-Endpoints header itself is set by the
  // deployment operator; here we only wire the CSP directive.
  const reportEndpoint = getServerEnv('CSP_REPORT_ENDPOINT');
  if (reportEndpoint && /^[a-z0-9_-]{1,64}$/i.test(reportEndpoint)) {
    directives.push(`report-to ${reportEndpoint}`);
  }
  return directives.join('; ');
}

export function applySecurityHeaders(
  response: Response,
  requestUrl: string | URL,
): Response {
  const url = new URL(requestUrl);
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }

  if (url.protocol === 'https:') {
    headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY);
  }

  if (shouldApplyContentSecurityPolicy(url.pathname)) {
    headers.set('Content-Security-Policy', buildContentSecurityPolicy());
  }

  // Authenticated HTML must not be retained by browser or intermediary
  // caches. API responses already set this at their domain boundary; applying
  // it here covers the server-rendered dashboard, Studio, and login pages.
  if (isAdminPath(url.pathname)) {
    headers.set('Cache-Control', 'no-store');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
