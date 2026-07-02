import type { APIRoute } from 'astro';
import {
  adminJson,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../../../lib/server/admin';
import {
  ensureSameOrigin,
  readJsonBody,
  requestBodyErrorResponse,
} from '../../../lib/server/community';
import {
  getSpotifyCredentialsStatus,
  updateSpotifyCredentials,
} from '../../../lib/server/spotify/credentials';
import { clearCachedSpotifyState } from '../../../lib/server/spotify/cache';
import { clearSpotifyTokenCache } from '../../../lib/server/spotify/client';

export const GET: APIRoute = async ({ cookies }) => {
  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  const status = await getSpotifyCredentialsStatus();
  return adminJson({ credentials: status });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);

  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  let body: {
    spotify?: {
      clientId?: string;
      clientSecret?: string;
      refreshToken?: string;
    };
    lanyard?: { discordUserId?: string };
  };

  try {
    body = await readJsonBody<typeof body>(request);
  } catch (error) {
    return withAdminSecurityHeaders(requestBodyErrorResponse(error));
  }

  if (!body.spotify && !body.lanyard) {
    return adminJson(
      { error: 'No credential fields provided.', code: 'invalid_request' },
      { status: 400 },
    );
  }

  try {
    await updateSpotifyCredentials(body);
    clearSpotifyTokenCache();
    clearCachedSpotifyState();
    const status = await getSpotifyCredentialsStatus();
    return adminJson({ credentials: status });
  } catch (error) {
    console.error('[spotify-credentials] PATCH failed', error);
    return adminJson(
      { error: 'Failed to save credentials.', code: 'storage_unavailable' },
      { status: 503 },
    );
  }
};
