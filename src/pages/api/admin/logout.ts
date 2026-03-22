import type { APIRoute } from 'astro';
import { clearAdminSession } from '../../../lib/server/admin';

async function handleLogout(request: Request, cookies: Parameters<APIRoute>[0]['cookies'], redirect: Parameters<APIRoute>[0]['redirect']) {
  clearAdminSession(cookies, request);
  return redirect('/admin/login?logged_out=1', 302);
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  return handleLogout(request, cookies, redirect);
};

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  return handleLogout(request, cookies, redirect);
};
