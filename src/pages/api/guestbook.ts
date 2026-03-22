/// <reference types="astro/client" />
import type { APIRoute } from 'astro';
import {
  ensureSameOrigin,
  enforceRedisRateLimit,
  hasRedisConfig,
  hasTurnstileConfig,
  json,
  rejectIfStorageUnavailable,
  verifyTurnstileToken,
} from '../../lib/server/community';
import {
  createGuestbookEntry,
  getApprovedGuestbookEntries,
  readGuestbookEntries,
  writeGuestbookEntries,
} from '../../lib/server/guestbook';

const GUESTBOOK_RATE_LIMIT = { limit: 3, windowMs: 10 * 60 * 1000 };

function sanitizeText(value: string, limit: number): string {
  return value.trim().slice(0, limit);
}

export const GET: APIRoute = async () => {
  try {
    const entries = getApprovedGuestbookEntries(await readGuestbookEntries());
    return json(
      {
        entries,
        writable: hasRedisConfig() && hasTurnstileConfig(),
        reviewRequired: true,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[guestbook] GET failed', error);
    return json({ error: 'Could not load guestbook messages.', code: 'guestbook_unavailable' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return storageUnavailable;

  const captchaUnavailable = !hasTurnstileConfig()
    ? json(
        {
          error: 'Guestbook posting is temporarily unavailable because bot protection is not configured.',
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
    body = (await request.json()) as { name?: string; message?: string; captchaToken?: string };
  } catch {
    return json({ error: 'Invalid request.', code: 'invalid_request' }, { status: 400 });
  }

  const captchaError = await verifyTurnstileToken(request, body.captchaToken);
  if (captchaError) return captchaError;

  const name = sanitizeText(body.name ?? '', 32) || 'anon';
  const message = sanitizeText(body.message ?? '', 280);

  if (!message) {
    return json({ error: 'Message required.', code: 'message_required' }, { status: 400 });
  }

  if (message.length < 3) {
    return json({ error: 'Message is too short.', code: 'message_too_short' }, { status: 400 });
  }

  try {
    const entries = await readGuestbookEntries();
    const nextEntry = await createGuestbookEntry(request, name, message);
    await writeGuestbookEntries([nextEntry, ...entries]);

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
    return json({ error: 'Could not post message.', code: 'guestbook_unavailable' }, { status: 503 });
  }
};
