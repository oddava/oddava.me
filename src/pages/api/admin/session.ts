import type { APIRoute } from 'astro';
import {
  createAdminSessionValue,
  isAdminConfigured,
  setAdminSession,
  verifyAdminToken,
} from '../../../lib/server/admin';
import {
  ensureSameOrigin,
  enforceRedisRateLimit,
  json,
  readJsonBody,
  readUrlEncodedBody,
  rejectIfSigningUnavailable,
  requestBodyErrorResponse,
} from '../../../lib/server/community';

const LOGIN_RATE_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };

function safeNextPath(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : '/admin';
}

function wantsJson(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  const contentType = request.headers.get('content-type') ?? '';
  return accept.includes('application/json') || contentType.includes('application/json');
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const signingUnavailable = rejectIfSigningUnavailable();
  if (signingUnavailable) return signingUnavailable;

  const rateLimitError = await enforceRedisRateLimit(
    request,
    'admin-login',
    LOGIN_RATE_LIMIT.limit,
    LOGIN_RATE_LIMIT.windowMs,
  );
  if (rateLimitError) return rateLimitError;

  let token = '';
  let next = '/admin';

  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await readJsonBody<{ token?: string; next?: string }>(request);
      token = String(body.token ?? '');
      next = String(body.next ?? '/admin');
    } else {
      const formData = await readUrlEncodedBody(request);
      token = String(formData.get('token') ?? '');
      next = String(formData.get('next') ?? '/admin');
    }
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  if (!isAdminConfigured()) {
    return wantsJson(request)
      ? json({ error: 'Admin authentication is not configured.' }, { status: 503 })
      : new Response('Admin authentication is not configured.', { status: 503 });
  }

  if (!(await verifyAdminToken(token))) {
    if (wantsJson(request)) {
      return json({ error: 'The admin token was rejected.', next: '/admin/login?error=invalid' }, { status: 401 });
    }
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('error', 'invalid');
    loginUrl.searchParams.set('next', safeNextPath(next));
    return redirect(loginUrl.pathname + loginUrl.search, 302);
  }

  setAdminSession(cookies, request, await createAdminSessionValue(token));
  if (wantsJson(request)) {
    return json({ ok: true, next: safeNextPath(next) }, { status: 200 });
  }
  return redirect(safeNextPath(next), 302);
};
