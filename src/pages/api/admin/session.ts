import type { APIRoute } from 'astro';
import {
  clearAdminSession,
  createAdminSessionValue,
  isAdminConfigured,
  setAdminSession,
  verifyAdminToken,
} from '../../../lib/server/admin';
import { json } from '../../../lib/server/community';

function wantsJson(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  const contentType = request.headers.get('content-type') ?? '';
  return accept.includes('application/json') || contentType.includes('application/json');
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  let token = '';
  let next = '/admin';

  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as { token?: string; next?: string };
    token = String(body.token ?? '');
    next = String(body.next ?? '/admin');
  } else {
    const formData = await request.formData();
    token = String(formData.get('token') ?? '');
    next = String(formData.get('next') ?? '/admin');
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
    if (next.startsWith('/')) loginUrl.searchParams.set('next', next);
    return redirect(loginUrl.pathname + loginUrl.search, 302);
  }

  setAdminSession(cookies, request, await createAdminSessionValue(token));
  if (wantsJson(request)) {
    return json({ ok: true, next: next.startsWith('/') ? next : '/admin' }, { status: 200 });
  }
  return redirect(next.startsWith('/') ? next : '/admin', 302);
};

export const DELETE: APIRoute = async ({ request, cookies, redirect }) => {
  clearAdminSession(cookies, request);
  if (wantsJson(request)) {
    return json({ ok: true, next: '/admin/login?logged_out=1' }, { status: 200 });
  }
  return redirect('/admin/login?logged_out=1', 302);
};
