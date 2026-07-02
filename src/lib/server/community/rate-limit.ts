import type { AstroCookies } from 'astro';
import { json } from './http';
import { getClientIp } from './request';
import {
  getClientFingerprint,
  signString,
  verifyStringSignature,
} from './signing';
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

export async function enforceSignedCooldown(
  cookies: AstroCookies,
  request: Request,
  cookieName: string,
  windowMs: number,
): Promise<Response | null> {
  const current = cookies.get(cookieName)?.value;
  const now = Date.now();

  if (current) {
    const [issuedAtRaw, ip, signature] = current.split('.');
    const issuedAt = Number(issuedAtRaw);
    if (issuedAt && ip && signature) {
      const payload = `${issuedAt}.${ip}`;
      if (await verifyStringSignature(payload, signature)) {
        const age = now - issuedAt;
        if (ip === getClientIp(request) && age >= 0 && age < windowMs) {
          const retryAfterSeconds = Math.ceil((windowMs - age) / 1000);
          return json(
            {
              error: 'Too many requests. Please slow down.',
              retryAfterSeconds,
            },
            {
              status: 429,
              headers: { 'Retry-After': String(retryAfterSeconds) },
            },
          );
        }
      }
    }
  }

  const ip = getClientIp(request);
  const payload = `${now}.${ip}`;
  const signature = await signString(payload);
  cookies.set(cookieName, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge: Math.ceil(windowMs / 1000),
  });

  return null;
}

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
