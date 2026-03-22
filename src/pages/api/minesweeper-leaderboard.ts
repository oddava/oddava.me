/// <reference types="astro/client" />
import type { APIRoute } from 'astro';
import {
  createSignedValue,
  ensureSameOrigin,
  enforceRedisRateLimit,
  hasRedisConfig,
  isSecureRequest,
  isStorageUnavailableError,
  json,
  readSignedValue,
  rejectIfStorageUnavailable,
} from '../../lib/server/community';
import {
  type MinesweeperDifficulty,
  normalizeDifficulty,
  normalizeEntries,
  readLeaderboard,
  writeLeaderboard,
} from '../../lib/server/minesweeper';

const SESSION_COOKIE = 'minesweeper-session';
const SESSION_TTL_SECONDS = 60 * 60 * 2;
const START_RATE_LIMIT = { limit: 12, windowMs: 10 * 60 * 1000 };
const SUBMIT_RATE_LIMIT = { limit: 6, windowMs: 10 * 60 * 1000 };
const MINIMUM_TIMES: Record<MinesweeperDifficulty, number> = {
  easy: 8,
  medium: 25,
  hard: 60,
};

interface SignedMinesweeperSession {
  difficulty: MinesweeperDifficulty;
  startedAt: number;
  sessionId: string;
  submitted?: boolean;
}

export const GET: APIRoute = async ({ url }) => {
  const difficulty = normalizeDifficulty(url.searchParams.get('difficulty'));
  if (!difficulty) {
    return json({ error: 'Invalid difficulty.' }, { status: 400 });
  }

  try {
    const entries = await readLeaderboard(difficulty);
    return json({ entries: normalizeEntries(entries), writable: hasRedisConfig() }, { status: 200 });
  } catch (error) {
    console.error('[minesweeper] GET failed', error);
    if (isStorageUnavailableError(error)) {
      return json({ entries: [], writable: false }, { status: 200 });
    }
    return json({ error: 'Could not load leaderboard.' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return storageUnavailable;

  const rateLimitError = await enforceRedisRateLimit(
    request,
    'minesweeper-submit',
    SUBMIT_RATE_LIMIT.limit,
    SUBMIT_RATE_LIMIT.windowMs,
  );
  if (rateLimitError) return rateLimitError;

  let body: { difficulty?: string; time?: number };

  try {
    body = (await request.json()) as { difficulty?: string; time?: number };
  } catch {
    return json({ error: 'Invalid request.' }, { status: 400 });
  }

  const difficulty = normalizeDifficulty(body.difficulty);
  const time = Number(body.time);

  if (!difficulty) {
    return json({ error: 'Invalid difficulty.' }, { status: 400 });
  }

  if (!Number.isFinite(time) || time <= 0) {
    return json({ error: 'Invalid time.' }, { status: 400 });
  }

  if (time < MINIMUM_TIMES[difficulty]) {
    return json({ error: 'Time is not plausible for this difficulty.' }, { status: 400 });
  }

  const session = await readSignedValue<SignedMinesweeperSession>(cookies.get(SESSION_COOKIE)?.value);
  const now = Date.now();
  if (!session || session.difficulty !== difficulty || !session.sessionId || session.submitted) {
    return json({ error: 'Missing or invalid game session.' }, { status: 403 });
  }

  const elapsedSeconds = Math.floor((now - session.startedAt) / 1000);
  if (elapsedSeconds <= 0 || elapsedSeconds + 2 < time || elapsedSeconds > SESSION_TTL_SECONDS) {
    return json({ error: 'Submitted time does not match the active game session.' }, { status: 400 });
  }

  try {
    const existing = await readLeaderboard(difficulty);
    const next = normalizeEntries([
      ...existing,
      {
        time,
        createdAt: new Date().toISOString(),
      },
    ]);

    await writeLeaderboard(difficulty, next);
    const usedSession = await createSignedValue({ ...session, submitted: true });
    cookies.set(SESSION_COOKIE, usedSession, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isSecureRequest(request),
      path: '/',
      maxAge: 60,
    });

    return json({ entries: next, writable: true }, { status: 200 });
  } catch (error) {
    console.error('[minesweeper] POST failed', error);
    if (isStorageUnavailableError(error)) {
      return json(
        {
          error: 'This shared feature is temporarily unavailable because persistent storage is not configured.',
          code: 'storage_unavailable',
        },
        { status: 503 },
      );
    }
    return json({ error: 'Could not submit score.' }, { status: 503 });
  }
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return storageUnavailable;

  const rateLimitError = await enforceRedisRateLimit(
    request,
    'minesweeper-session',
    START_RATE_LIMIT.limit,
    START_RATE_LIMIT.windowMs,
  );
  if (rateLimitError) return rateLimitError;

  let body: { difficulty?: string };

  try {
    body = (await request.json()) as { difficulty?: string };
  } catch {
    return json({ error: 'Invalid request.' }, { status: 400 });
  }

  const difficulty = normalizeDifficulty(body.difficulty);
  if (!difficulty) {
    return json({ error: 'Invalid difficulty.' }, { status: 400 });
  }

  const value = await createSignedValue({
    difficulty,
    startedAt: Date.now(),
    sessionId: crypto.randomUUID(),
    submitted: false,
  });

  cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureRequest(request),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  return json({ ok: true }, { status: 200 });
};
