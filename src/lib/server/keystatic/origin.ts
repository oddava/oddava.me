export function firstForwardedHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

export function parseOrigin(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function getKeystaticRequestOrigin(
  request: Request,
  configuredOrigin = import.meta.env.KEYSTATIC_PUBLIC_ORIGIN,
): URL | null {
  const configured = configuredOrigin?.trim();
  if (configured) {
    return parseOrigin(configured);
  }

  const forwardedHost = firstForwardedHeaderValue(
    request.headers.get('x-forwarded-host'),
  );
  if (!forwardedHost) {
    return null;
  }

  const forwardedProto = firstForwardedHeaderValue(
    request.headers.get('x-forwarded-proto'),
  );
  const proto = (forwardedProto ?? 'https').toLowerCase();

  return parseOrigin(
    `${proto === 'http' ? 'http' : 'https'}://${forwardedHost}`,
  );
}

export function normalizeKeystaticRequestOrigin(
  request: Request,
  configuredOrigin = import.meta.env.KEYSTATIC_PUBLIC_ORIGIN,
): Request {
  const targetOrigin = getKeystaticRequestOrigin(request, configuredOrigin);
  if (!targetOrigin) {
    return request;
  }

  const originalUrl = new URL(request.url);
  if (targetOrigin.origin === originalUrl.origin) {
    return request;
  }

  const rewritten = new URL(request.url);
  rewritten.protocol = targetOrigin.protocol;
  rewritten.host = targetOrigin.host;

  return new Request(rewritten.toString(), request);
}
