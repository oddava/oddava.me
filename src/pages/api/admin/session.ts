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
  prefersJsonResponse,
  readJsonBody,
  readUrlEncodedBody,
  rejectIfSigningUnavailable,
  requestBodyErrorResponse,
  safeRedirectPath,
} from '../../../lib/server/community';

const LOGIN_RATE_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };

const safeNextPath = (value: string) => safeRedirectPath(value, '/admin');

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
      const body = await readJsonBody<{ token?: string; next?: string }>(
        request,
      );
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
    return prefersJsonResponse(request)
      ? json(
          { error: 'Admin authentication is not configured.' },
          { status: 503 },
        )
      : new Response('Admin authentication is not configured.', {
          status: 503,
        });
  }

  if (!(await verifyAdminToken(token))) {
    if (prefersJsonResponse(request)) {
      return json(
        {
          error: 'The admin token was rejected.',
          next: '/admin/login?error=invalid',
        },
        { status: 401 },
      );
    }
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('error', 'invalid');
    loginUrl.searchParams.set('next', safeNextPath(next));
    return redirect(loginUrl.pathname + loginUrl.search, 302);
  }

  setAdminSession(cookies, request, await createAdminSessionValue(token));
  if (prefersJsonResponse(request)) {
    return json({ ok: true, next: safeNextPath(next) }, { status: 200 });
  }
  return redirect(safeNextPath(next), 302);
};
