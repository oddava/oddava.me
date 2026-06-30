import type { APIRoute } from 'astro';
import { clearAdminSession } from '../../../lib/server/admin';
import { ensureSameOrigin } from '../../../lib/server/community';

async function handleLogout(
  request: Request,
  cookies: Parameters<APIRoute>[0]['cookies'],
  redirect: Parameters<APIRoute>[0]['redirect'],
) {
  clearAdminSession(cookies, request);
  return redirect('/admin/login?logged_out=1', 302);
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return sameOriginError;
  return handleLogout(request, cookies, redirect);
};
