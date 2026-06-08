import type { AstroCookies } from 'astro';
import { getServerEnv } from './env';

type AppEnv = 'development' | 'production';
type RedisMode = 'local' | 'upstash';

const REDIS_API_URL =
  getServerEnv('UPSTASH_REDIS_REST_URL') ??
  getServerEnv('UPSTASH_REDIS_REST_KV_REST_API_URL');
const REDIS_API_TOKEN =
  getServerEnv('UPSTASH_REDIS_REST_TOKEN') ??
  getServerEnv('UPSTASH_REDIS_REST_KV_REST_API_TOKEN');
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

const TURNSTILE_SECRET_KEY = getServerEnv('TURNSTILE_SECRET_KEY');
const TURNSTILE_BYPASS_IN_DEV =
  getServerEnv('TURNSTILE_BYPASS_IN_DEV') === 'true';
const TURNSTILE_VERIFY_ENDPOINT =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_JSON_BODY_LIMIT_BYTES = 16 * 1024;

let environmentLogged = false;

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    '',
  );
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getSigningSecret(): string {
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

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, {
        once: true,
      });
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyError(
      'Request body is too large.',
      413,
      'payload_too_large',
    );
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(
          'Request body is too large.',
          413,
          'payload_too_large',
        );
      }

      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return text + decoder.decode();
}

export async function readJsonBody<T>(
  request: Request,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
): Promise<T> {
  const text = await readLimitedBody(request, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RequestBodyError('Invalid request.', 400, 'invalid_request');
  }
}

export async function readUrlEncodedBody(
  request: Request,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
): Promise<URLSearchParams> {
  return new URLSearchParams(await readLimitedBody(request, maxBytes));
}

export function requestBodyErrorResponse(error: unknown): Response {
  if (error instanceof RequestBodyError) {
    return json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return json(
    { error: 'Invalid request.', code: 'invalid_request' },
    { status: 400 },
  );
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeTextToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function decodeBase64UrlToText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

function isDevelopmentEnv(): boolean {
  return APP_ENV === 'development';
}

function shouldUseLocalRedis(): boolean {
  return REDIS_MODE === 'local';
}

function logRuntimeEnvironment(): void {
  if (environmentLogged) return;
  environmentLogged = true;
  console.info(
    `[runtime] APP_ENV=${APP_ENV} REDIS_MODE=${REDIS_MODE} TURNSTILE_BYPASS_IN_DEV=${
      isDevelopmentEnv() && TURNSTILE_BYPASS_IN_DEV ? 'true' : 'false'
    }`,
  );
}

function getStorageNamespacePrefix(): string {
  return isDevelopmentEnv() ? 'dev:' : '';
}

type RedisArgument = string | number;

function namespaceRedisCommand(command: RedisArgument[]): string[] {
  const normalized = command.map(String);
  const operation = normalized[0]?.toUpperCase();

  if (operation === 'EVAL' || operation === 'EVALSHA') {
    const keyCount = Number(normalized[2] ?? 0);
    for (let index = 0; index < keyCount; index += 1) {
      const keyIndex = 3 + index;
      normalized[keyIndex] = withNamespace(normalized[keyIndex]);
    }
    return normalized;
  }

  if (normalized[1]) {
    normalized[1] = withNamespace(normalized[1]);
  }
  return normalized;
}

export async function redisCommand<T = unknown>(
  command: RedisArgument[],
): Promise<T> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }

  if (shouldUseLocalRedis()) {
    const { executeLocalRedisCommand } = await import('./local-redis');
    return executeLocalRedisCommand<T>(
      namespaceRedisCommand(command),
      LOCAL_REDIS_URL,
    );
  }

  const response = await fetchWithTimeout(REDIS_API_URL!, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    result?: T;
    error?: string;
  };

  if (!response.ok || payload.error) {
    throw new Error(
      `Redis command failed: ${response.status} ${payload.error ?? 'Unknown error'}`,
    );
  }

  return payload.result as T;
}

export function hasRedisConfig(): boolean {
  logRuntimeEnvironment();
  if (shouldUseLocalRedis()) return true;
  return Boolean(REDIS_API_URL && REDIS_API_TOKEN);
}

function withNamespace(rawKey: string): string {
  return `${getStorageNamespacePrefix()}${rawKey}`;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  if (!headers.has('X-Content-Type-Options'))
    headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function rejectIfStorageUnavailable(): Response | null {
  if (hasRedisConfig()) return null;
  return json(
    {
      error:
        'This shared feature is temporarily unavailable because persistent storage is not configured.',
      code: 'storage_unavailable',
    },
    { status: 503 },
  );
}

export function rejectIfSigningUnavailable(): Response | null {
  if (hasCommunitySigningSecret()) return null;
  return json(
    {
      error:
        'This feature is unavailable because COMMUNITY_SIGNING_SECRET is not configured.',
      code: 'signing_unavailable',
    },
    { status: 503 },
  );
}

export function isStorageUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'Persistent storage is not configured.',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'The client is closed',
    'Socket closed unexpectedly',
    'fetch failed',
  ].some((fragment) => message.includes(fragment));
}

function getRequestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) return origin;

  const referer = request.headers.get('referer');
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function getForwardedProtocol(request: Request): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() || 'https';
  }

  return new URL(request.url).protocol.replace(/:$/, '');
}

export function isSecureRequest(request: Request): boolean {
  return getForwardedProtocol(request) === 'https';
}

function getForwardedHost(request: Request): string | null {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    return forwardedHost.split(',')[0]?.trim() || null;
  }

  return request.headers.get('host');
}

function getRequestTargetOrigin(request: Request): string {
  const forwardedHost = getForwardedHost(request);
  if (forwardedHost) {
    return `${getForwardedProtocol(request)}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

export function ensureSameOrigin(request: Request): Response | null {
  const requestOrigin = getRequestTargetOrigin(request);
  const submittedOrigin = getRequestOrigin(request);

  if (!submittedOrigin || submittedOrigin !== requestOrigin) {
    return json(
      { error: 'Cross-origin requests are not allowed.' },
      { status: 403 },
    );
  }

  return null;
}

function getClientIp(request: Request): string {
  const cloudflareIp = request.headers.get('cf-connecting-ip');
  if (cloudflareIp) return cloudflareIp.trim();

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('fly-client-ip') ??
    'unknown'
  );
}

export function getClientIpAddress(request: Request): string {
  return getClientIp(request);
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSigningSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verify(value: string, expected: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(getSigningSecret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(expected).buffer as ArrayBuffer,
      new TextEncoder().encode(value),
    );
  } catch {
    return false;
  }
}

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
      if (await verify(payload, signature)) {
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
  const signature = await sign(payload);
  cookies.set(cookieName, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge: Math.ceil(windowMs / 1000),
  });

  return null;
}

export async function getClientFingerprint(request: Request): Promise<string> {
  return sign(`client-ip:${getClientIp(request)}`);
}

export async function enforceRedisRateLimit(
  request: Request,
  feature: string,
  limit: number,
  windowMs: number,
): Promise<Response | null> {
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

export function hasTurnstileConfig(): boolean {
  if (isDevelopmentEnv() && TURNSTILE_BYPASS_IN_DEV) return true;
  return Boolean(getTurnstileSiteKey() && TURNSTILE_SECRET_KEY);
}

export function isTurnstileChallengeRequired(): boolean {
  return (
    hasTurnstileConfig() && !(isDevelopmentEnv() && TURNSTILE_BYPASS_IN_DEV)
  );
}

export function getTurnstileSiteKey(): string | undefined {
  return getServerEnv('PUBLIC_TURNSTILE_SITE_KEY');
}

export async function verifyTurnstileToken(
  request: Request,
  token: string | undefined,
): Promise<Response | null> {
  if (isDevelopmentEnv() && TURNSTILE_BYPASS_IN_DEV) {
    return null;
  }

  if (!hasTurnstileConfig()) {
    return json(
      {
        error:
          'Guestbook posting is unavailable because bot protection is not configured.',
        code: 'captcha_unavailable',
      },
      { status: 503 },
    );
  }

  if (!token) {
    return json(
      {
        error: 'Bot verification is required.',
        code: 'captcha_required',
      },
      { status: 400 },
    );
  }

  let verificationResponse: Response;
  try {
    verificationResponse = await fetchWithTimeout(TURNSTILE_VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: TURNSTILE_SECRET_KEY!,
        response: token,
        remoteip: getClientIp(request),
      }),
    });
  } catch (error) {
    console.error('[turnstile] verification request failed', error);
    return json(
      {
        error: 'Bot verification is temporarily unavailable.',
        code: 'captcha_unavailable',
      },
      { status: 502 },
    );
  }

  if (!verificationResponse.ok) {
    return json(
      {
        error: 'Bot verification failed.',
        code: 'captcha_failed',
      },
      { status: 502 },
    );
  }

  const payload = (await verificationResponse.json()) as { success?: boolean };
  if (!payload.success) {
    return json(
      {
        error: 'Bot verification failed.',
        code: 'captcha_failed',
      },
      { status: 400 },
    );
  }

  return null;
}

export async function createSignedValue(
  payload: Record<string, unknown>,
): Promise<string> {
  const body = encodeTextToBase64Url(JSON.stringify(payload));
  const signature = await sign(body);
  return `${body}.${signature}`;
}

export async function readSignedValue<T>(
  value: string | undefined,
): Promise<T | null> {
  if (!value) return null;

  const separatorIndex = value.lastIndexOf('.');
  if (separatorIndex === -1) return null;

  const body = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);

  if (!(await verify(body, signature))) return null;

  try {
    return JSON.parse(decodeBase64UrlToText(body)) as T;
  } catch {
    return null;
  }
}
