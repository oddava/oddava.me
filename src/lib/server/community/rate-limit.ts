import { json } from './http';
import { getClientFingerprint } from './signing';
import {
  hasRedisConfig,
  isStorageUnavailableError,
  redisCommand,
  rejectIfStorageUnavailable,
} from './storage';
import { isDevelopmentEnv } from './config';

type RedisRateLimitOptions = {
  failOpenInDevelopment?: boolean;
};

export async function enforceRedisRateLimit(
  request: Request,
  feature: string,
  limit: number,
  windowMs: number,
  options: RedisRateLimitOptions = {},
): Promise<Response | null> {
  if (options.failOpenInDevelopment && isDevelopmentEnv()) return null;

  if (!hasRedisConfig()) {
    return rejectIfStorageUnavailable();
  }

  const ipHash = await getClientFingerprint(request);
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `community:rate-limit:${feature}:${ipHash}:${bucket}`;
  const script = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    return { count, redis.call('PTTL', KEYS[1]) }
  `;
  let result: Array<number | string>;
  try {
    result = await redisCommand<Array<number | string>>([
      'EVAL',
      script,
      1,
      key,
      windowMs,
    ]);
  } catch (error) {
    if (
      options.failOpenInDevelopment &&
      isDevelopmentEnv() &&
      isStorageUnavailableError(error)
    ) {
      console.warn(
        `[rate-limit] ${feature} unavailable in development; allowing request.`,
        error,
      );
      return null;
    }

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
  const ttlMs = Math.max(1000, Number(result[1] ?? windowMs));

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
