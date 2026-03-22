import type { APIRoute } from 'astro';
import { requireAdminApi } from '../../../lib/server/admin';
import { json, rejectIfStorageUnavailable } from '../../../lib/server/community';
import {
  clearLeaderboard,
  deleteLeaderboardEntry,
  normalizeDifficulty,
  readLeaderboard,
} from '../../../lib/server/minesweeper';

export const GET: APIRoute = async ({ cookies, url }) => {
  const authError = await requireAdminApi(cookies);
  if (authError) return authError;

  const difficulty = normalizeDifficulty(url.searchParams.get('difficulty'));
  if (!difficulty) {
    return json({ error: 'Invalid difficulty.', code: 'invalid_request' }, { status: 400 });
  }

  const entries = await readLeaderboard(difficulty);
  return json({ difficulty, entries }, { status: 200 });
};

async function handleDeleteRequest(body: {
  difficulty?: string;
  createdAt?: string;
  time?: number;
  clearAll?: boolean;
}): Promise<Response> {
  const difficulty = normalizeDifficulty(body.difficulty);
  if (!difficulty) {
    return json({ error: 'Invalid difficulty.', code: 'invalid_request' }, { status: 400 });
  }

  if (body.clearAll) {
    await clearLeaderboard(difficulty);
    return json({ difficulty, entries: [] }, { status: 200 });
  }

  const time = Number(body.time);
  if (!body.createdAt || !Number.isFinite(time)) {
    return json({ error: 'Missing entry identifier.', code: 'invalid_request' }, { status: 400 });
  }

  const entries = await deleteLeaderboardEntry(difficulty, {
    createdAt: body.createdAt,
    time,
  });

  return json({ difficulty, entries }, { status: 200 });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const authError = await requireAdminApi(cookies);
  if (authError) return authError;

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return storageUnavailable;

  let body: { difficulty?: string; createdAt?: string; time?: number; clearAll?: boolean };

  try {
    body = (await request.json()) as { difficulty?: string; createdAt?: string; time?: number; clearAll?: boolean };
  } catch {
    return json({ error: 'Invalid request.', code: 'invalid_request' }, { status: 400 });
  }

  if ((body as { action?: string }).action !== 'delete') {
    return json({ error: 'Invalid action.', code: 'invalid_request' }, { status: 400 });
  }

  return handleDeleteRequest(body);
};
