import type { APIRoute } from 'astro';
import { requireSecuredAdminApi } from '../../../../lib/server/admin';
import {
  ensureSameOrigin,
  readJsonBody,
  requestBodyErrorResponse,
} from '../../../../lib/server/community';
import { toggleIntegration } from '../../../../lib/server/integrations';
import {
  adminJson,
  integrationErrorResponse,
  withAdminSecurityHeaders,
} from './_shared';

/** Enables or disables an integration. */
export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);

  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  let body: { enabled?: unknown };
  try {
    body = await readJsonBody<{ enabled?: unknown }>(request);
  } catch (error) {
    return withAdminSecurityHeaders(requestBodyErrorResponse(error));
  }

  if (typeof body.enabled !== 'boolean') {
    return adminJson(
      { error: '`enabled` must be a boolean.', code: 'invalid_request' },
      { status: 400 },
    );
  }

  try {
    const integration = await toggleIntegration(params.id ?? '', body.enabled);
    return adminJson({ integration });
  } catch (error) {
    return integrationErrorResponse(error);
  }
};
