import type { APIRoute } from 'astro';
import { clearAdminSession } from '../../../lib/server/admin';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  clearAdminSession(cookies, request.url);
  return redirect('/admin/login?logged_out=1', 302);
};
