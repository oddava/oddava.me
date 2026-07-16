import type { APIRoute } from 'astro';
import { requireSecuredAdminApi } from '../../../../../lib/server/admin';
import {
  ensureSameOrigin,
  readJsonBody,
  requestBodyErrorResponse,
} from '../../../../../lib/server/core';
import {
  revokeIntegrationCredentials,
  saveIntegrationCredentials,
} from '../../../../../lib/server/integrations';
import {
  adminJson,
  integrationErrorResponse,
  withAdminSecurityHeaders,
} from '../_shared';

/**
 * Applies a partial credential update. Only the fields present in the body are
 * touched; a field sent as an empty string clears that single override.
 *
 * Credentials are write-only over this API — the response carries status and
 * provenance, never secret material.
 */
export const PUT: APIRoute = async ({ request, cookies, params }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);

  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return withAdminSecurityHeaders(requestBodyErrorResponse(error));
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return adminJson(
      {
        error: 'Expected an object of credential fields.',
        code: 'invalid_request',
      },
      { status: 400 },
    );
  }

  try {
    const integration = await saveIntegrationCredentials(params.id ?? '', body);
    return adminJson({ integration });
  } catch (error) {
    return integrationErrorResponse(error);
  }
};

/** Revokes every stored credential override for this integration. */
export const DELETE: APIRoute = async ({ request, cookies, params }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);

  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  try {
    const integration = await revokeIntegrationCredentials(params.id ?? '');
    return adminJson({ integration });
  } catch (error) {
    return integrationErrorResponse(error);
  }
};
