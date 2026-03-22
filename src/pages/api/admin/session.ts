import type { APIRoute } from 'astro';
import {
  clearAdminSession,
  createAdminSessionValue,
  isAdminConfigured,
  setAdminSession,
  verifyAdminToken,
} from '../../../lib/server/admin';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const token = String(formData.get('token') ?? '');
  const next = String(formData.get('next') ?? '/admin');

  if (!isAdminConfigured()) {
    return new Response('Admin authentication is not configured.', { status: 503 });
  }

  if (!(await verifyAdminToken(token))) {
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('error', 'invalid');
    if (next.startsWith('/')) loginUrl.searchParams.set('next', next);
    return redirect(loginUrl.pathname + loginUrl.search, 302);
  }

  setAdminSession(cookies, request.url, await createAdminSessionValue(token));
  return redirect(next.startsWith('/') ? next : '/admin', 302);
};

export const DELETE: APIRoute = async ({ request, cookies, redirect }) => {
  clearAdminSession(cookies, request.url);
  return redirect('/admin/login?logged_out=1', 302);
};
