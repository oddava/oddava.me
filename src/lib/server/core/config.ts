import { getServerEnv } from '../env';
import { firstConfiguredSecret } from '../secrets';

type AppEnv = 'development' | 'production';
type RedisMode = 'local' | 'upstash';

export const DEFAULT_FETCH_TIMEOUT_MS = 5000;
export const DEFAULT_JSON_BODY_LIMIT_BYTES = 16 * 1024;

const REDIS_API_URL = firstConfiguredSecret(
  getServerEnv('UPSTASH_REDIS_REST_URL'),
  getServerEnv('UPSTASH_REDIS_REST_KV_REST_API_URL'),
);
const REDIS_API_TOKEN = firstConfiguredSecret(
  getServerEnv('UPSTASH_REDIS_REST_TOKEN'),
  getServerEnv('UPSTASH_REDIS_REST_KV_REST_API_TOKEN'),
);
const LOCAL_REDIS_URL =
  getServerEnv('LOCAL_REDIS_URL') ?? 'redis://127.0.0.1:6379';

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

export function getSigningSecret(): string {
  const secret = firstConfiguredSecret(
    getServerEnv('COMMUNITY_SIGNING_SECRET'),
  );
  if (!secret) {
    throw new Error(
      'COMMUNITY_SIGNING_SECRET is required for signed sessions and tokens.',
    );
  }
  return secret;
}

export function hasSigningSecret(): boolean {
  return Boolean(
    firstConfiguredSecret(getServerEnv('COMMUNITY_SIGNING_SECRET')),
  );
}

export function isDevelopmentEnv(): boolean {
  return APP_ENV === 'development';
}

export function shouldUseLocalRedis(): boolean {
  return REDIS_MODE === 'local';
}

export function getStorageNamespacePrefix(): string {
  return isDevelopmentEnv() ? 'dev:' : '';
}

export function logRuntimeEnvironment(): void {
  if (environmentLogged) return;
  environmentLogged = true;
  console.info(`[runtime] APP_ENV=${APP_ENV} REDIS_MODE=${REDIS_MODE}`);
}
