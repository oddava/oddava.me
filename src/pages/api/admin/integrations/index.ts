import type { APIRoute } from 'astro';
import { requireSecuredAdminApi } from '../../../../lib/server/admin';
import { listIntegrations } from '../../../../lib/server/integrations';
import { adminJson, integrationErrorResponse } from './_shared';

export const GET: APIRoute = async ({ cookies }) => {
  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  try {
    return adminJson({ integrations: await listIntegrations() });
  } catch (error) {
    return integrationErrorResponse(error);
  }
};
