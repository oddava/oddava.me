import type { APIRoute } from 'astro';
import {
  adminJson,
  requireSecuredAdminApi,
  setIntegrationSetting,
  withAdminSecurityHeaders,
} from '../../../lib/server/admin';
import type { ManageableIntegration } from '../../../lib/server/admin/settings';
import {
  ensureSameOrigin,
  readJsonBody,
  requestBodyErrorResponse,
} from '../../../lib/server/community';

const VALID_NAMES: ManageableIntegration[] = ['spotify'];

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);

  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  let body: { name?: string; enabled?: boolean };

  try {
    body = await readJsonBody<{ name?: string; enabled?: boolean }>(request);
  } catch (error) {
    return withAdminSecurityHeaders(requestBodyErrorResponse(error));
  }

  const name = body.name as ManageableIntegration | undefined;
  if (
    !name ||
    !VALID_NAMES.includes(name) ||
    typeof body.enabled !== 'boolean'
  ) {
    return adminJson(
      { error: 'Missing valid name and enabled.', code: 'invalid_request' },
      { status: 400 },
    );
  }

  try {
    const settings = await setIntegrationSetting(name, body.enabled);
    return adminJson(settings, { status: 200 });
  } catch (error) {
    console.error('[admin-settings] PATCH failed', error);
    return adminJson(
      { error: 'Failed to update setting.', code: 'admin_unavailable' },
      { status: 500 },
    );
  }
};
