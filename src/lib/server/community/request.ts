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

function getForwardedProtocol(request: Request): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() || 'https';
  }

  return new URL(request.url).protocol.replace(/:$/, '');
}

function getForwardedHost(request: Request): string | null {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    return forwardedHost.split(',')[0]?.trim() || null;
  }

  return request.headers.get('host');
}

function getRequestTargetOrigin(request: Request): string {
  const forwardedHost = getForwardedHost(request);
  if (forwardedHost) {
    return `${getForwardedProtocol(request)}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

export function isSecureRequest(request: Request): boolean {
  return getForwardedProtocol(request) === 'https';
}

export function ensureSameOrigin(request: Request): Response | null {
  const requestOrigin = getRequestTargetOrigin(request);
  const submittedOrigin = getRequestOrigin(request);

  if (!submittedOrigin || submittedOrigin !== requestOrigin) {
    return json(
      { error: 'Cross-origin requests are not allowed.' },
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
  const cloudflareIp = request.headers.get('cf-connecting-ip');
  if (cloudflareIp) return cloudflareIp.trim();

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

export function getClientIpAddress(request: Request): string {
  return getClientIp(request);
}
