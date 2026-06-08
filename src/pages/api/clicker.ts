import type { APIRoute } from 'astro';
import {
  ensureSameOrigin,
  enforceRedisRateLimit,
  hasCommunitySigningSecret,
  hasRedisConfig,
  isStorageUnavailableError,
  json,
  rejectIfSigningUnavailable,
  rejectIfStorageUnavailable,
} from '../../lib/server/community';
import { getClickerCount, incrementClickerCount } from '../../lib/server/clicker';

const CLICKER_RATE_LIMIT = { limit: 60, windowMs: 60 * 1000 };

export const GET: APIRoute = async () => {
  try {
    const count = await getClickerCount();
    return json(
      { count, writable: hasRedisConfig() && hasCommunitySigningSecret() },
      { status: 200 },
    );
  } catch (error) {
    console.error('[clicker] GET failed', error);
    if (isStorageUnavailableError(error)) {
      return json({ count: 0, writable: false }, { status: 200 });
    }
    return json({ error: 'Could not load click count.' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return storageUnavailable;

  const signingUnavailable = rejectIfSigningUnavailable();
  if (signingUnavailable) return signingUnavailable;

  const rateLimitError = await enforceRedisRateLimit(
    request,
    'clicker-post',
    CLICKER_RATE_LIMIT.limit,
    CLICKER_RATE_LIMIT.windowMs,
  );
  if (rateLimitError) return rateLimitError;

  try {
    const count = await incrementClickerCount();
    return json({ count, writable: true }, { status: 200 });
  } catch (error) {
    console.error('[clicker] POST failed', error);
    if (isStorageUnavailableError(error)) {
      return json(
        {
          error: 'This shared feature is temporarily unavailable because persistent storage is not configured.',
          code: 'storage_unavailable',
        },
        { status: 503 },
      );
    }
    return json({ error: 'Could not update click count.' }, { status: 503 });
  }
};
