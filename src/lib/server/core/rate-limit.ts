import { json } from './http';
import { getClientFingerprint } from './signing';
import {
  hasRedisConfig,
  redisCommand,
  rejectIfStorageUnavailable,
} from './storage';
import { isDevelopmentEnv } from './config';

/** The key a count lives under: one per feature, visitor and window. */
async function limitKey(
  request: Request,
  feature: string,
  windowMs: number,
  options: RedisRateLimitOptions,
): Promise<string> {
  const ipHash = options.everyone
    ? 'everyone'
    : await getClientFingerprint(request);
  const bucket = Math.floor((options.now ?? Date.now()) / windowMs);
  // `community:` is kept for the same reason as the guestbook entries key: it
  // is a live key prefix, and the rename is code-level only.
  return `community:rate-limit:${feature}:${ipHash}:${bucket}`;
}

type RedisRateLimitOptions = {
  failOpenInDevelopment?: boolean;
  /**
   * One count shared by every visitor instead of one each: a ceiling on the
   * whole site's rate, for when per-visitor limits can be multiplied by
   * anyone holding many addresses.
   */
  everyone?: boolean;
  /**
   * The moment the count is for (default: now). Pass the same moment to the
   * refund as to the charge, so a request that crosses a window's boundary
   * gives back what it took, not a count from the next window.
   */
  now?: number;
};

export async function enforceRedisRateLimit(
  request: Request,
  feature: string,
  limit: number,
  windowMs: number,
  options: RedisRateLimitOptions = {},
): Promise<Response | null> {
  // Opted-in routes (admin login) skip rate limiting entirely in development,
  // so a local Redis or signing hiccup can never lock the developer out. This
  // is also why the catch below only needs to handle the production case.
  if (options.failOpenInDevelopment && isDevelopmentEnv()) return null;

  if (!hasRedisConfig()) {
    return rejectIfStorageUnavailable();
  }

  const script = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    return { count, redis.call('PTTL', KEYS[1]) }
  `;
  let result: Array<number | string>;
  try {
    // The fingerprint (an HMAC under the signing secret) is computed inside the
    // try so a misconfigured secret degrades to the same 503 as a storage
    // outage, rather than throwing an unhandled 500 out of this guard.
    const key = await limitKey(request, feature, windowMs, options);
    result = await redisCommand<Array<number | string>>([
      'EVAL',
      script,
      1,
      key,
      windowMs,
    ]);
  } catch (error) {
    console.error(`[rate-limit] ${feature} failed`, error);
    return json(
      {
        error: 'Request protection is temporarily unavailable.',
        code: 'rate_limit_unavailable',
      },
      { status: 503 },
    );
  }
  const count = Number(result[0] ?? 0);
  // The count lives in a fixed window: it resets when the window ends, which
  // can be long before the key itself would expire (a key made just before
  // the boundary still carries a whole window's TTL). Tell the truth about
  // the earlier of the two.
  const windowEndsInMs = windowMs - ((options.now ?? Date.now()) % windowMs);
  const ttlMs = Math.max(
    1000,
    Math.min(Number(result[1] ?? windowMs), windowEndsInMs),
  );

  if (count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    return json(
      {
        error: 'Too many requests. Please slow down.',
        code: 'rate_limited',
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      },
    );
  }

  return null;
}

/**
 * Gives back one count taken by enforceRedisRateLimit, for a request that
 * was counted but then came to nothing (a bad body, a full sky, a storage
 * blip): what a visitor is limited on is what they got, not what they
 * tried. Best effort: a failure here leaves the count, which only errs
 * toward the limit.
 */
export async function refundRedisRateLimit(
  request: Request,
  feature: string,
  windowMs: number,
  options: Pick<RedisRateLimitOptions, 'everyone' | 'now'> = {},
): Promise<void> {
  if (!hasRedisConfig()) return;
  try {
    const key = await limitKey(request, feature, windowMs, options);
    await redisCommand([
      'EVAL',
      `if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then
         return redis.call('DECR', KEYS[1])
       end
       return 0`,
      1,
      key,
    ]);
  } catch (error) {
    console.warn(`[rate-limit] ${feature} refund failed`, error);
  }
}
