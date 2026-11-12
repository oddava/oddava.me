import type { APIRoute } from 'astro';
import {
  ensureSameOrigin,
  isStorageUnavailableError,
  parseModerationStatus,
  readJsonBody,
  rejectIfStorageUnavailable,
  requestBodyErrorResponse,
  type ModeratedRecord,
  type ModerationStatus,
} from '../core';
import { requireSecuredAdminApi } from './auth';
import { adminJson, withAdminSecurityHeaders } from './response';

/** What a moderated feature hands the admin routes. */
export interface ModerationStore<T extends ModeratedRecord> {
  read(): Promise<T[]>;
  setStatus(id: string, status: ModerationStatus): Promise<boolean>;
  /**
   * Optional: sets `status` on everything the visitor behind `id` left.
   * Mounted as POST { action: 'visitor', id, status }.
   */
  setVisitorStatus?(id: string, status: ModerationStatus): Promise<number>;
  /**
   * Optional: sets `status` on everything created in the last `minutes`.
   * Mounted as POST { action: 'since', minutes, status }.
   */
  setStatusSince?(since: string, status: ModerationStatus): Promise<number>;
  clearUnapproved(): Promise<number>;
}

type Cookies = Parameters<APIRoute>[0]['cookies'];

async function rejectIfAdminUnavailable(
  cookies: Cookies,
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
  cookies: Cookies,
): Promise<Response | null> {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return withAdminSecurityHeaders(sameOriginError);

  return rejectIfAdminUnavailable(cookies);
}

/**
 * The admin API for one moderated list: GET ?status= to list, PATCH
 * { id, status } to decide, POST { action: 'clear', all: true } to drop the
 * unapproved, and, where the store supports it, POST { action: 'visitor',
 * id, status } to decide everything one visitor left. The guestbook and the sky's stars both mount it, so the two
 * inboxes cannot drift apart in auth, same-origin checks or error shape.
 */
export function createModerationRoutes<T extends ModeratedRecord>(
  store: ModerationStore<T>,
  label: string,
): { GET: APIRoute; PATCH: APIRoute; POST: APIRoute } {
  const GET: APIRoute = async ({ cookies, url }) => {
    const unavailable = await rejectIfAdminUnavailable(cookies);
    if (unavailable) return unavailable;

    const statusFilter = parseModerationStatus(url.searchParams.get('status'));

    try {
      const entries = await store.read();
      const filteredEntries = statusFilter
        ? entries.filter((entry) => entry.status === statusFilter)
        : entries;
      return adminJson({ entries: filteredEntries }, { status: 200 });
    } catch (error) {
      if (isStorageUnavailableError(error)) {
        return adminJson({ entries: [] }, { status: 200 });
      }

      console.error(`[${label}] GET failed`, error);
      return adminJson(
        { error: 'Failed to load entries.', code: 'admin_unavailable' },
        { status: 500 },
      );
    }
  };

  const PATCH: APIRoute = async ({ request, cookies }) => {
    const unavailable = await rejectIfInvalidMutation(request, cookies);
    if (unavailable) return unavailable;

    let body: { id?: string; status?: string };

    try {
      body = await readJsonBody<{ id?: string; status?: string }>(request);
    } catch (error) {
      return withAdminSecurityHeaders(requestBodyErrorResponse(error));
    }

    const status = parseModerationStatus(body.status);
    if (!body.id || typeof body.id !== 'string' || !status) {
      return adminJson(
        { error: 'Missing id or valid status.', code: 'invalid_request' },
        { status: 400 },
      );
    }

    try {
      const updated = await store.setStatus(body.id, status);
      if (!updated) {
        return adminJson(
          { error: 'Entry not found.', code: 'not_found' },
          { status: 404 },
        );
      }
      return adminJson({ entries: await store.read() }, { status: 200 });
    } catch (error) {
      console.error(`[${label}] PATCH failed`, error);
      return adminJson(
        { error: 'Failed to update entry.', code: 'admin_unavailable' },
        { status: 500 },
      );
    }
  };

  const POST: APIRoute = async ({ request, cookies }) => {
    const unavailable = await rejectIfInvalidMutation(request, cookies);
    if (unavailable) return unavailable;

    let body: {
      action?: string;
      all?: boolean;
      id?: unknown;
      status?: unknown;
    };

    try {
      body = await readJsonBody<typeof body>(request);
    } catch (error) {
      return withAdminSecurityHeaders(requestBodyErrorResponse(error));
    }

    if (body.action === 'visitor' && store.setVisitorStatus) {
      const status = parseModerationStatus(
        typeof body.status === 'string' ? body.status : null,
      );
      if (typeof body.id !== 'string' || !body.id || !status) {
        return adminJson(
          { error: 'Missing id or valid status.', code: 'invalid_request' },
          { status: 400 },
        );
      }
      try {
        const updated = await store.setVisitorStatus(body.id, status);
        return adminJson(
          { updated, entries: await store.read() },
          { status: 200 },
        );
      } catch (error) {
        console.error(`[${label}] visitor update failed`, error);
        return adminJson(
          { error: 'Failed to update entries.', code: 'admin_unavailable' },
          { status: 500 },
        );
      }
    }

    if (body.action === 'since' && store.setStatusSince) {
      const status = parseModerationStatus(
        typeof body.status === 'string' ? body.status : null,
      );
      const minutes = Number((body as { minutes?: unknown }).minutes);
      if (
        !status ||
        !Number.isFinite(minutes) ||
        minutes < 1 ||
        minutes > 10080
      ) {
        return adminJson(
          {
            error: 'Missing minutes (1 to 10080) or valid status.',
            code: 'invalid_request',
          },
          { status: 400 },
        );
      }
      try {
        const since = new Date(Date.now() - minutes * 60_000).toISOString();
        const updated = await store.setStatusSince(since, status);
        return adminJson(
          { updated, entries: await store.read() },
          { status: 200 },
        );
      } catch (error) {
        console.error(`[${label}] since update failed`, error);
        return adminJson(
          { error: 'Failed to update entries.', code: 'admin_unavailable' },
          { status: 500 },
        );
      }
    }

    if (body.action !== 'clear') {
      return adminJson(
        { error: 'Invalid action.', code: 'invalid_request' },
        { status: 400 },
      );
    }

    if (body.all !== true) {
      return adminJson(
        { error: 'Missing all=true.', code: 'invalid_request' },
        { status: 400 },
      );
    }

    try {
      await store.clearUnapproved();
      return adminJson({ entries: await store.read() }, { status: 200 });
    } catch (error) {
      console.error(`[${label}] clear-all failed`, error);
      return adminJson(
        { error: 'Failed to clear entries.', code: 'admin_unavailable' },
        { status: 500 },
      );
    }
  };

  return { GET, PATCH, POST };
}
