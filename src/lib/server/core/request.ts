import { getServerEnv } from '../env';
import { json } from './http';

function getRequestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) return origin;

  const referer = request.headers.get('referer');
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

export function ensureSameOrigin(request: Request): Response | null {
  const requestOrigin = new URL(request.url).origin;
  const submittedOrigin = getRequestOrigin(request);

  if (!submittedOrigin || submittedOrigin !== requestOrigin) {
    return json(
      { error: 'Cross-origin requests are not allowed.', code: 'cross_origin' },
      { status: 403 },
    );
  }

  return null;
}

export function prefersJsonResponse(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  const contentType = request.headers.get('content-type') ?? '';
  return (
    accept.includes('application/json') ||
    contentType.includes('application/json')
  );
}

export function safeRedirectPath(value: string, fallback = '/'): string {
  return value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
    ? value
    : fallback;
}

export function getClientIp(request: Request): string {
  // Cloudflare sets `cf-connecting-ip` on every request it proxies. When it
  // is present we trust it unconditionally as the client address.
  const cloudflareIp = request.headers.get('cf-connecting-ip');
  if (cloudflareIp) return cloudflareIp.trim();

  const isProduction =
    getServerEnv('APP_ENV') === 'production' ||
    import.meta.env.MODE === 'production';

  if (isProduction) {
    // In production we expect to be running behind Cloudflare, so a missing
    // `cf-connecting-ip` is suspicious: the request may be reaching the
    // worker through an unproxied path, in which case `x-forwarded-for` is
    // client-controlled and trivially spoofable. Return a sentinel rather
    // than trusting it, so rate-limiting/analytics don't silently honor
    // attacker-chosen IPs.
    console.warn(
      '[request] cf-connecting-ip absent in production; refusing to fall back to spoofable x-forwarded-for.',
    );
    return 'unknown';
  }

  // Dev: behind `vite dev` / local proxies, the XFF chain is the best signal
  // we have and spoofing is not a concern.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('fly-client-ip') ??
    'unknown'
  );
}
