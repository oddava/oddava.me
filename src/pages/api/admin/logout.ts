import type { APIRoute } from 'astro';
import {
  adminRedirect,
  clearAdminSession,
  withAdminSecurityHeaders,
} from '../../../lib/server/admin';
import { ensureSameOrigin } from '../../../lib/server/core';

async function handleLogout(
  request: Request,
  cookies: Parameters<APIRoute>[0]['cookies'],
) {
  clearAdminSession(cookies, request);
  return adminRedirect('/admin/login?logged_out=1');
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);
  return handleLogout(request, cookies);
};
