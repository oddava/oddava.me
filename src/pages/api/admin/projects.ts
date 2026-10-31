/// <reference types="astro/client" />
import type { APIRoute } from 'astro';
import {
  ensureSameOrigin,
  isStorageUnavailableError,
  readJsonBody,
  rejectIfStorageUnavailable,
  requestBodyErrorResponse,
} from '../../../lib/server/core';
import {
  adminJson,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../../../lib/server/admin';
import {
  parseProjects,
  readProjects,
  writeProjects,
} from '../../../lib/server/projects';

async function rejectIfAdminUnavailable(
  cookies: Parameters<APIRoute>[0]['cookies'],
): Promise<Response | null> {
  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  const storageUnavailable = rejectIfStorageUnavailable();
  return storageUnavailable
    ? withAdminSecurityHeaders(storageUnavailable)
    : null;
}

function storageFailure(error: unknown, action: string): Response {
  if (isStorageUnavailableError(error)) {
    return adminJson(
      { error: 'The data store is unreachable.', code: 'storage_unavailable' },
      { status: 503 },
    );
  }
  console.error(`[projects-admin] ${action} failed`, error);
  return adminJson(
    { error: `Failed to ${action} projects.`, code: 'admin_unavailable' },
    { status: 500 },
  );
}

export const GET: APIRoute = async ({ cookies }) => {
  const unavailable = await rejectIfAdminUnavailable(cookies);
  if (unavailable) return unavailable;

  try {
    return adminJson(await readProjects(), { status: 200 });
  } catch (error) {
    return storageFailure(error, 'load');
  }
};

/** Replaces the whole list, provided `revision` is still the stored one. */
export const PUT: APIRoute = async ({ request, cookies }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);

  const unavailable = await rejectIfAdminUnavailable(cookies);
  if (unavailable) return unavailable;

  let body: { revision?: unknown; projects?: unknown };
  try {
    body = await readJsonBody<typeof body>(request);
  } catch (error) {
    return withAdminSecurityHeaders(requestBodyErrorResponse(error));
  }

  const revision = body.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) {
    return adminJson(
      { error: 'Missing revision.', code: 'invalid_request' },
      { status: 400 },
    );
  }

  const parsed = parseProjects(body.projects);
  if (!parsed.ok) {
    return adminJson(
      {
        error: parsed.issues[0]?.message ?? 'Invalid projects.',
        code: 'invalid_request',
        issues: parsed.issues,
      },
      { status: 400 },
    );
  }

  try {
    const written = await writeProjects(parsed.projects, revision);
    if (!written.ok) {
      return adminJson(
        {
          error:
            'Projects were changed somewhere else. The latest list is loaded; make your edit again.',
          code: 'conflict',
        },
        { status: 409 },
      );
    }
    return adminJson(
      { projects: parsed.projects, revision: written.revision },
      { status: 200 },
    );
  } catch (error) {
    return storageFailure(error, 'save');
  }
};
