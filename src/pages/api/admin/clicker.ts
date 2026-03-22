import type { APIRoute } from 'astro';
import { requireAdminApi } from '../../../lib/server/admin';
import { json, rejectIfStorageUnavailable } from '../../../lib/server/community';
import { getClickerCount, setClickerCount } from '../../../lib/server/clicker';

export const GET: APIRoute = async ({ cookies }) => {
  const authError = await requireAdminApi(cookies);
  if (authError) return authError;

  const count = await getClickerCount();
  return json({ count });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const authError = await requireAdminApi(cookies);
  if (authError) return authError;

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return storageUnavailable;

  let body: { count?: number };

  try {
    body = (await request.json()) as { count?: number };
  } catch {
    return json({ error: 'Invalid request.', code: 'invalid_request' }, { status: 400 });
  }

  const count = Number(body.count);
  if (!Number.isFinite(count) || count < 0) {
    return json({ error: 'Count must be a non-negative number.', code: 'invalid_request' }, { status: 400 });
  }

  const next = await setClickerCount(count);
  return json({ count: next }, { status: 200 });
};
