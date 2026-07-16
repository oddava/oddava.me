import type { APIRoute } from 'astro';
import { requireSecuredAdminApi } from '../../../../../lib/server/admin';
import { ensureSameOrigin } from '../../../../../lib/server/core';
import { testIntegration } from '../../../../../lib/server/integrations';
import {
  adminJson,
  integrationErrorResponse,
  withAdminSecurityHeaders,
} from '../_shared';

/**
 * Runs a live connection test, bypassing the status cache and the circuit
 * breaker. POST rather than GET because it makes a real upstream call.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);

  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  try {
    const integration = await testIntegration(params.id ?? '');
    return adminJson({ integration });
  } catch (error) {
    return integrationErrorResponse(error);
  }
};
