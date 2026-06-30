import { getServerEnv } from '../env';

type AppEnv = 'development' | 'production';
type RedisMode = 'local' | 'upstash';

export const DEFAULT_FETCH_TIMEOUT_MS = 5000;
export const DEFAULT_JSON_BODY_LIMIT_BYTES = 16 * 1024;
export const TURNSTILE_VERIFY_ENDPOINT =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const REDIS_API_URL =
  getServerEnv('UPSTASH_REDIS_REST_URL') ??
  getServerEnv('UPSTASH_REDIS_REST_KV_REST_API_URL');
const REDIS_API_TOKEN =
  getServerEnv('UPSTASH_REDIS_REST_TOKEN') ??
  getServerEnv('UPSTASH_REDIS_REST_KV_REST_API_TOKEN');
const LOCAL_REDIS_URL =
  getServerEnv('LOCAL_REDIS_URL') ?? 'redis://127.0.0.1:6379';
const TURNSTILE_SECRET_KEY = getServerEnv('TURNSTILE_SECRET_KEY');
const TURNSTILE_BYPASS_IN_DEV =
  getServerEnv('TURNSTILE_BYPASS_IN_DEV') === 'true';

const APP_ENV: AppEnv =
  getServerEnv('APP_ENV') === 'production' ||
  import.meta.env.MODE === 'production'
    ? 'production'
    : 'development';
const REDIS_MODE: RedisMode =
  getServerEnv('REDIS_MODE') === 'upstash'
    ? 'upstash'
    : getServerEnv('REDIS_MODE') === 'local'
      ? 'local'
      : APP_ENV === 'production'
        ? 'upstash'
        : 'local';

let environmentLogged = false;

export function getRedisApiConfig(): {
  url: string | undefined;
  token: string | undefined;
} {
  return { url: REDIS_API_URL, token: REDIS_API_TOKEN };
}

export function getLocalRedisUrl(): string {
  return LOCAL_REDIS_URL;
}

export function getTurnstileSecretKey(): string | undefined {
  return TURNSTILE_SECRET_KEY;
}

export function getTurnstileSiteKey(): string | undefined {
  return getServerEnv('PUBLIC_TURNSTILE_SITE_KEY');
}

export function getSigningSecret(): string {
  const secret = getServerEnv('COMMUNITY_SIGNING_SECRET')?.trim();
  if (!secret) {
    throw new Error(
      'COMMUNITY_SIGNING_SECRET is required for signed sessions and tokens.',
    );
  }
  return secret;
}

export function hasCommunitySigningSecret(): boolean {
  return Boolean(getServerEnv('COMMUNITY_SIGNING_SECRET')?.trim());
}

export function isDevelopmentEnv(): boolean {
  return APP_ENV === 'development';
}

export function shouldUseLocalRedis(): boolean {
  return REDIS_MODE === 'local';
}

export function isTurnstileBypassEnabled(): boolean {
  return isDevelopmentEnv() && TURNSTILE_BYPASS_IN_DEV;
}

export function getStorageNamespacePrefix(): string {
  return isDevelopmentEnv() ? 'dev:' : '';
}

export function logRuntimeEnvironment(): void {
  if (environmentLogged) return;
  environmentLogged = true;
  console.info(
    `[runtime] APP_ENV=${APP_ENV} REDIS_MODE=${REDIS_MODE} TURNSTILE_BYPASS_IN_DEV=${
      isTurnstileBypassEnabled() ? 'true' : 'false'
    }`,
  );
}
