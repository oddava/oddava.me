/// <reference types="astro/client" />
import type { APIRoute } from 'astro';
import type { SkyApiResponse } from '../../lib/contracts';
import {
  ensureSameOrigin,
  enforceRedisRateLimit,
  hasRedisConfig,
  hasSigningSecret,
  isStorageUnavailableError,
  json,
  readJsonBody,
  refundRedisRateLimit,
  rejectIfSigningUnavailable,
  rejectIfStorageUnavailable,
  requestBodyErrorResponse,
  withBriefEdgeCache,
} from '../../lib/server/core';
import { isAdminRequest } from '../../lib/server/admin';
import {
  appendStar,
  createStar,
  getPublicStars,
  parseSkyCoordinate,
  inMoonZone,
  readStars,
  sanitizeStarWord,
  toPublicStar,
} from '../../lib/server/sky';

/**
 * How long one data center shares a read of the sky. The list is the whole
 * store, so this is what keeps a busy page from reading all of it per
 * visitor; the page adds its own new star itself, so nobody waits on it.
 */
const SKY_CACHE_SECONDS = 15;

/** Three stars a day from one visitor: enough to draw a small shape. */
const STAR_RATE_LIMIT = { limit: 3, windowMs: 24 * 60 * 60 * 1000 };

/**
 * Sixty an hour from everyone together. Far above a personal site's real
 * rate, and what keeps someone with a pool of addresses (each with its own
 * three) from filling the sky in an afternoon: a full sky closes for all.
 */
const SKY_RATE_LIMIT = { limit: 60, windowMs: 60 * 60 * 1000 };

const reply = (body: SkyApiResponse, status: number, headers = {}) =>
  json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });

export const GET: APIRoute = async ({ url, locals }) =>
  withBriefEdgeCache(
    `${url.origin}${url.pathname}`,
    SKY_CACHE_SECONDS,
    locals?.cfContext?.waitUntil.bind(locals.cfContext),
    readSky,
  );

async function readSky(): Promise<Response> {
  const writable = hasRedisConfig() && hasSigningSecret();
  try {
    return reply({ stars: getPublicStars(await readStars()), writable }, 200);
  } catch (error) {
    // A blip is a 503, never an empty sky: "no stars yet" would be untrue,
    // and a 200 would be shared from the edge cache for its whole window.
    if (!isStorageUnavailableError(error)) {
      console.error('[sky] GET failed', error);
    }
    return reply(
      { error: 'Could not load the sky.', code: 'sky_unavailable' },
      503,
    );
  }
}

/**
 * The same guard chain as the guestbook, in the same order: same origin,
 * storage, signing, then the visitor's rate limit before the body is even
 * read, so a flood of malformed stars is throttled like any other.
 *
 * A well-formed star that does not land through no fault of the visitor's
 * (the sky busy or full, a storage blip) gives its count back: three a day
 * are three stars, not three tries. A malformed one keeps its count. The
 * site-wide hourly cap is counted only for a well-formed star, so junk
 * cannot close the sky for everyone.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return storageUnavailable;

  const signingUnavailable = rejectIfSigningUnavailable();
  if (signingUnavailable) return signingUnavailable;

  // One moment for every charge and refund below, so a request that runs
  // across midnight (or the hour) gives back exactly what it took.
  const now = Date.now();
  const rateLimitError = await enforceRedisRateLimit(
    request,
    'sky-star',
    STAR_RATE_LIMIT.limit,
    STAR_RATE_LIMIT.windowMs,
    { now },
  );
  if (rateLimitError) return rateLimitError;

  const refundVisitor = () =>
    refundRedisRateLimit(request, 'sky-star', STAR_RATE_LIMIT.windowMs, {
      now,
    });
  const refundEveryone = () =>
    refundRedisRateLimit(request, 'sky-star-all', SKY_RATE_LIMIT.windowMs, {
      everyone: true,
      now,
    });

  let body: { x?: unknown; y?: unknown; word?: unknown };
  try {
    body = await readJsonBody<{ x?: unknown; y?: unknown; word?: unknown }>(
      request,
    );
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const x = parseSkyCoordinate(body.x);
  const y = parseSkyCoordinate(body.y);
  if (x === null || y === null) {
    return reply(
      { error: 'A star needs a place in the sky.', code: 'invalid_position' },
      400,
    );
  }
  if (inMoonZone(x, y)) {
    // The page never offers this spot; only a hand-made request lands here.
    return reply(
      { error: 'That spot is the moon’s.', code: 'invalid_position' },
      400,
    );
  }
  const word = sanitizeStarWord(body.word);

  const busy = await enforceRedisRateLimit(
    request,
    'sky-star-all',
    SKY_RATE_LIMIT.limit,
    SKY_RATE_LIMIT.windowMs,
    { everyone: true, now },
  );
  if (busy) {
    await refundVisitor();
    if (busy.status !== 429) return busy;
    // The everyone-count went over by this one; it did not land either.
    await refundEveryone();
    const retry = Number(busy.headers.get('Retry-After')) || 600;
    return reply(
      {
        error: 'Lots of stars tonight. Try again in a little while.',
        code: 'sky_busy',
        retryAfterSeconds: retry,
      },
      429,
      { 'Retry-After': String(retry) },
    );
  }

  try {
    // Words wait for the moderator, so a star the moderator leaves (signed
    // in to the admin) is read already: its word shows to everyone at once
    // instead of only in the browser that placed it. A session that does
    // not verify is just a visitor's star.
    const byModerator = word
      ? await isAdminRequest(cookies).catch(() => false)
      : false;
    const star = await createStar(request, x, y, word, { byModerator });
    if ((await appendStar(star)) === 'full') {
      await Promise.all([refundVisitor(), refundEveryone()]);
      return reply(
        { error: 'The sky is full tonight.', code: 'sky_full' },
        409,
      );
    }
    const wordPending = star.status === 'pending';
    return reply(
      {
        star: toPublicStar(star),
        wordPending,
        message: wordPending
          ? 'Your star is up. Its word shows once it has been read.'
          : 'Your star is up.',
      },
      201,
    );
  } catch (error) {
    await Promise.all([refundVisitor(), refundEveryone()]);
    console.error('[sky] POST failed', error);
    if (isStorageUnavailableError(error)) {
      return reply(
        {
          error: 'The sky is out of reach right now. Try again shortly.',
          code: 'storage_unavailable',
        },
        503,
      );
    }
    return reply(
      { error: 'Could not place your star.', code: 'sky_unavailable' },
      503,
    );
  }
};
