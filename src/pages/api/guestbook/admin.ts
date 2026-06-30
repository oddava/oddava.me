/// <reference types="astro/client" />
import type { APIRoute } from 'astro';
import {
  ensureSameOrigin,
  json,
  readJsonBody,
  rejectIfStorageUnavailable,
  requestBodyErrorResponse,
} from '../../../lib/server/community';
import {
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../../../lib/server/admin';
import {
  parseGuestbookStatus,
  readGuestbookEntries,
  updateGuestbookEntryStatus,
  writeGuestbookEntries,
} from '../../../lib/server/guestbook';

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

async function rejectIfInvalidMutation(
  request: Request,
  cookies: Parameters<APIRoute>[0]['cookies'],
): Promise<Response | null> {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);

  return rejectIfAdminUnavailable(cookies);
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const unavailable = await rejectIfAdminUnavailable(cookies);
  if (unavailable) return unavailable;

  const statusFilter = parseGuestbookStatus(url.searchParams.get('status'));

  try {
    const entries = await readGuestbookEntries();
    const filteredEntries = statusFilter
      ? entries.filter((entry) => entry.status === statusFilter)
      : entries;
    return withAdminSecurityHeaders(
      json({ entries: filteredEntries }, { status: 200 }),
    );
  } catch (error) {
    console.error('[guestbook-admin] GET failed', error);
    return withAdminSecurityHeaders(
      json(
        { error: 'Failed to load entries.', code: 'admin_unavailable' },
        { status: 500 },
      ),
    );
  }
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const unavailable = await rejectIfInvalidMutation(request, cookies);
  if (unavailable) return unavailable;

  let body: { id?: string; status?: string };

  try {
    body = await readJsonBody<{ id?: string; status?: string }>(request);
  } catch (error) {
    return withAdminSecurityHeaders(requestBodyErrorResponse(error));
  }

  const status = parseGuestbookStatus(body.status);
  if (!body.id || !status) {
    return withAdminSecurityHeaders(
      json(
        { error: 'Missing id or valid status.', code: 'invalid_request' },
        { status: 400 },
      ),
    );
  }

  try {
    const updated = await updateGuestbookEntryStatus(body.id, status);
    if (!updated) {
      return withAdminSecurityHeaders(
        json({ error: 'Entry not found.', code: 'not_found' }, { status: 404 }),
      );
    }
    const next = await readGuestbookEntries();
    return withAdminSecurityHeaders(json({ entries: next }, { status: 200 }));
  } catch (error) {
    console.error('[guestbook-admin] PATCH failed', error);
    return withAdminSecurityHeaders(
      json(
        { error: 'Failed to update entry.', code: 'admin_unavailable' },
        { status: 500 },
      ),
    );
  }
};

async function handleClearAllRequest(clearAll: boolean): Promise<Response> {
  if (!clearAll) {
    return withAdminSecurityHeaders(
      json(
        { error: 'Missing all=true.', code: 'invalid_request' },
        { status: 400 },
      ),
    );
  }

  try {
    await writeGuestbookEntries([]);
    return withAdminSecurityHeaders(json({ entries: [] }, { status: 200 }));
  } catch (error) {
    console.error('[guestbook-admin] clear-all failed', error);
    return withAdminSecurityHeaders(
      json(
        { error: 'Failed to clear entries.', code: 'admin_unavailable' },
        { status: 500 },
      ),
    );
  }
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const unavailable = await rejectIfInvalidMutation(request, cookies);
  if (unavailable) return unavailable;

  let body: { action?: string; all?: boolean };

  try {
    body = await readJsonBody<{ action?: string; all?: boolean }>(request);
  } catch (error) {
    return withAdminSecurityHeaders(requestBodyErrorResponse(error));
  }

  if (body.action !== 'clear') {
    return withAdminSecurityHeaders(
      json(
        { error: 'Invalid action.', code: 'invalid_request' },
        { status: 400 },
      ),
    );
  }

  return handleClearAllRequest(body.all === true);
};
