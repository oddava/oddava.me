/// <reference types="astro/client" />
import type { APIRoute } from 'astro';
import { json, rejectIfStorageUnavailable } from '../../../lib/server/community';
import type { GuestbookStatus } from '../../../lib/server/guestbook';
import { requireAdminApi } from '../../../lib/server/admin';
import {
  readGuestbookEntries,
  writeGuestbookEntries,
} from '../../../lib/server/guestbook';

function normalizeStatus(value: string | null): GuestbookStatus | null {
  if (value === 'pending' || value === 'approved' || value === 'rejected') return value;
  return null;
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(response.body, { status: response.status, headers });
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const authError = await requireAdminApi(cookies);
  if (authError) return withSecurityHeaders(authError);

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return withSecurityHeaders(storageUnavailable);

  const statusFilter = normalizeStatus(url.searchParams.get('status'));

  try {
    const entries = await readGuestbookEntries();
    const filteredEntries = statusFilter ? entries.filter((entry) => entry.status === statusFilter) : entries;
    return withSecurityHeaders(json({ entries: filteredEntries }, { status: 200 }));
  } catch (error) {
    console.error('[guestbook-admin] GET failed', error);
    return withSecurityHeaders(json({ error: 'Failed to load entries.', code: 'admin_unavailable' }, { status: 500 }));
  }
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const authError = await requireAdminApi(cookies);
  if (authError) return withSecurityHeaders(authError);

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return withSecurityHeaders(storageUnavailable);

  let body: { id?: string; status?: string };

  try {
    body = (await request.json()) as { id?: string; status?: string };
  } catch {
    return withSecurityHeaders(json({ error: 'Invalid request.', code: 'invalid_request' }, { status: 400 }));
  }

  const status = normalizeStatus(body.status ?? null);
  if (!body.id || !status) {
    return withSecurityHeaders(json({ error: 'Missing id or valid status.', code: 'invalid_request' }, { status: 400 }));
  }

  try {
    const entries = await readGuestbookEntries();
    const next = entries.map((entry) => (entry.id === body.id ? { ...entry, status } : entry));
    await writeGuestbookEntries(next);
    return withSecurityHeaders(json({ entries: next }, { status: 200 }));
  } catch (error) {
    console.error('[guestbook-admin] PATCH failed', error);
    return withSecurityHeaders(json({ error: 'Failed to update entry.', code: 'admin_unavailable' }, { status: 500 }));
  }
};

async function handleClearAllRequest(clearAll: boolean): Promise<Response> {
  if (!clearAll) {
    return withSecurityHeaders(json({ error: 'Missing all=true.', code: 'invalid_request' }, { status: 400 }));
  }

  try {
    await writeGuestbookEntries([]);
    return withSecurityHeaders(json({ entries: [] }, { status: 200 }));
  } catch (error) {
    console.error('[guestbook-admin] clear-all failed', error);
    return withSecurityHeaders(json({ error: 'Failed to clear entries.', code: 'admin_unavailable' }, { status: 500 }));
  }
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const authError = await requireAdminApi(cookies);
  if (authError) return withSecurityHeaders(authError);

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return withSecurityHeaders(storageUnavailable);

  let body: { action?: string; all?: boolean };

  try {
    body = (await request.json()) as { action?: string; all?: boolean };
  } catch {
    return withSecurityHeaders(json({ error: 'Invalid request.', code: 'invalid_request' }, { status: 400 }));
  }

  if (body.action !== 'clear') {
    return withSecurityHeaders(json({ error: 'Invalid action.', code: 'invalid_request' }, { status: 400 }));
  }

  return handleClearAllRequest(body.all === true);
};
