/// <reference types="astro/client" />
import type { APIRoute } from 'astro';
import {
  ensureSameOrigin,
  enforceRedisRateLimit,
  hasCommunitySigningSecret,
  hasRedisConfig,
  hasTurnstileConfig,
  getTurnstileSiteKey,
  isTurnstileChallengeRequired,
  isStorageUnavailableError,
  json,
  readJsonBody,
  rejectIfSigningUnavailable,
  rejectIfStorageUnavailable,
  requestBodyErrorResponse,
  verifyTurnstileToken,
} from '../../lib/server/community';
import {
  appendGuestbookEntry,
  createGuestbookEntry,
  getApprovedGuestbookEntries,
  readGuestbookEntries,
  toPublicGuestbookEntries,
} from '../../lib/server/guestbook';
import { sanitizePlainText } from '../../lib/server/community';

const GUESTBOOK_RATE_LIMIT = { limit: 3, windowMs: 10 * 60 * 1000 };

const NAME_MAX_LENGTH = 32;
const MESSAGE_MAX_LENGTH = 280;

export const GET: APIRoute = async () => {
  try {
    const entries = toPublicGuestbookEntries(
      getApprovedGuestbookEntries(await readGuestbookEntries()),
    );
    return json(
      {
        entries,
        writable:
          hasRedisConfig() &&
          hasTurnstileConfig() &&
          hasCommunitySigningSecret(),
        reviewRequired: true,
        captchaRequired: isTurnstileChallengeRequired(),
        turnstileSiteKey: getTurnstileSiteKey(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[guestbook] GET failed', error);
    if (isStorageUnavailableError(error)) {
      return json(
        {
          entries: [],
          writable: false,
          reviewRequired: true,
          captchaRequired: isTurnstileChallengeRequired(),
          turnstileSiteKey: getTurnstileSiteKey(),
        },
        { status: 200 },
      );
    }
    return json(
      {
        error: 'Could not load guestbook messages.',
        code: 'guestbook_unavailable',
      },
      { status: 503 },
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return storageUnavailable;

  const signingUnavailable = rejectIfSigningUnavailable();
  if (signingUnavailable) return signingUnavailable;

  const captchaUnavailable = !hasTurnstileConfig()
    ? json(
        {
          error:
            'Guestbook posting is temporarily unavailable because bot protection is not configured.',
          code: 'captcha_unavailable',
        },
        { status: 503 },
      )
    : null;
  if (captchaUnavailable) return captchaUnavailable;

  const rateLimitError = await enforceRedisRateLimit(
    request,
    'guestbook-post',
    GUESTBOOK_RATE_LIMIT.limit,
    GUESTBOOK_RATE_LIMIT.windowMs,
  );
  if (rateLimitError) return rateLimitError;

  let body: { name?: string; message?: string; captchaToken?: string };

  try {
    body = await readJsonBody<{
      name?: string;
      message?: string;
      captchaToken?: string;
    }>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const captchaError = await verifyTurnstileToken(request, body.captchaToken);
  if (captchaError) return captchaError;

  const name = sanitizePlainText(body.name ?? '', NAME_MAX_LENGTH) || 'anon';
  const message = sanitizePlainText(body.message ?? '', MESSAGE_MAX_LENGTH);

  if (!message) {
    return json(
      { error: 'Message required.', code: 'message_required' },
      { status: 400 },
    );
  }

  if (message.length < 3) {
    return json(
      { error: 'Message is too short.', code: 'message_too_short' },
      { status: 400 },
    );
  }

  try {
    const nextEntry = await createGuestbookEntry(request, name, message);
    await appendGuestbookEntry(nextEntry);

    return json(
      {
        submitted: true,
        status: 'pending',
        message: 'Thanks. Your note will appear soon.',
      },
      { status: 202 },
    );
  } catch (error) {
    console.error('[guestbook] POST failed', error);
    if (isStorageUnavailableError(error)) {
      return json(
        {
          error:
            'This shared feature is temporarily unavailable because persistent storage is not configured.',
          code: 'storage_unavailable',
        },
        { status: 503 },
      );
    }
    return json(
      { error: 'Could not post message.', code: 'guestbook_unavailable' },
      { status: 503 },
    );
  }
};
