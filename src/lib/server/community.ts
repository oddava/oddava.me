import type { AstroCookies } from 'astro';
import { createClient, type RedisClientType } from 'redis';

type AppEnv = 'development' | 'production';
type RedisMode = 'local' | 'upstash';

const REDIS_API_URL =
  import.meta.env.UPSTASH_REDIS_REST_URL ??
  import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
const REDIS_API_TOKEN =
  import.meta.env.UPSTASH_REDIS_REST_TOKEN ??
  import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
const LOCAL_REDIS_URL = import.meta.env.LOCAL_REDIS_URL ?? 'redis://127.0.0.1:6379';
const APP_ENV: AppEnv =
  import.meta.env.APP_ENV === 'production' || import.meta.env.MODE === 'production'
    ? 'production'
    : 'development';
const REDIS_MODE: RedisMode =
  import.meta.env.REDIS_MODE === 'upstash'
    ? 'upstash'
    : import.meta.env.REDIS_MODE === 'local'
      ? 'local'
      : APP_ENV === 'production'
        ? 'upstash'
        : 'local';

const APP_SIGNING_SECRET =
  import.meta.env.COMMUNITY_SIGNING_SECRET ??
  import.meta.env.KEYSTATIC_SECRET ??
  REDIS_API_TOKEN;
const TURNSTILE_SECRET_KEY = import.meta.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_BYPASS_IN_DEV = import.meta.env.TURNSTILE_BYPASS_IN_DEV === 'true';
const TURNSTILE_VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

let localRedisClient: RedisClientType | null = null;
let environmentLogged = false;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
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

async function getLocalRedisClient(): Promise<RedisClientType> {
  if (!localRedisClient) {
    localRedisClient = createClient({ url: LOCAL_REDIS_URL });
  }

  if (!localRedisClient.isOpen) {
    await localRedisClient.connect();
  }

  return localRedisClient;
}

export function hasRedisConfig(): boolean {
  logRuntimeEnvironment();
  if (shouldUseLocalRedis()) return true;
  return Boolean(REDIS_API_URL && REDIS_API_TOKEN);
}

function withNamespace(rawKey: string): string {
  return `${getStorageNamespacePrefix()}${rawKey}`;
}

function decodeSegment(segment: string | undefined): string {
  return decodeURIComponent(segment ?? '');
}

function normalizeResult(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return String(value);
}

async function localRedisResponse(command: string): Promise<Response> {
  const [opRaw, ...segments] = command.split('/');
  const op = decodeSegment(opRaw).toLowerCase();

  const client = await getLocalRedisClient();
  const jsonHeaders = { 'Content-Type': 'application/json' };

  try {
    if (op === 'get') {
      const key = withNamespace(decodeSegment(segments[0]));
      const result = await client.get(key);
      return new Response(JSON.stringify({ result }), { status: 200, headers: jsonHeaders });
    }

    if (op === 'set') {
      const key = withNamespace(decodeSegment(segments[0]));
      const value = decodeSegment(segments[1]);
      const result = await client.set(key, value);
      return new Response(JSON.stringify({ result }), { status: 200, headers: jsonHeaders });
    }

    if (op === 'incr') {
      const key = withNamespace(decodeSegment(segments[0]));
      const result = await client.incr(key);
      return new Response(JSON.stringify({ result }), { status: 200, headers: jsonHeaders });
    }

    if (op === 'expire') {
      const key = withNamespace(decodeSegment(segments[0]));
      const ttlSeconds = Number(decodeSegment(segments[1]));
      const result = await client.expire(key, ttlSeconds);
      return new Response(JSON.stringify({ result }), { status: 200, headers: jsonHeaders });
    }

    if (op === 'del') {
      const key = withNamespace(decodeSegment(segments[0]));
      const result = await client.del(key);
      return new Response(JSON.stringify({ result }), { status: 200, headers: jsonHeaders });
    }

    if (op === 'lpush') {
      const key = withNamespace(decodeSegment(segments[0]));
      const values = segments.slice(1).map((segment) => decodeSegment(segment));
      const result = values.length > 0 ? await client.lPush(key, values) : 0;
      return new Response(JSON.stringify({ result }), { status: 200, headers: jsonHeaders });
    }

    if (op === 'lrange') {
      const key = withNamespace(decodeSegment(segments[0]));
      const start = Number(decodeSegment(segments[1] ?? '0'));
      const stop = Number(decodeSegment(segments[2] ?? '-1'));
      const result = await client.lRange(key, start, stop);
      return new Response(JSON.stringify({ result }), { status: 200, headers: jsonHeaders });
    }

    if (op === 'ltrim') {
      const key = withNamespace(decodeSegment(segments[0]));
      const start = Number(decodeSegment(segments[1] ?? '0'));
      const stop = Number(decodeSegment(segments[2] ?? '-1'));
      const result = await client.lTrim(key, start, stop);
      return new Response(JSON.stringify({ result: normalizeResult(result) }), { status: 200, headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ error: `Unsupported local redis operation: ${op}` }), {
      status: 400,
      headers: jsonHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: jsonHeaders });
  }
}

export async function redisRequest(command: string): Promise<Response> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }

  if (shouldUseLocalRedis()) {
    return localRedisResponse(command);
  }

  return fetch(`${REDIS_API_URL}/${command}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${REDIS_API_TOKEN}`,
    },
  });
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function rejectIfStorageUnavailable(): Response | null {
  if (hasRedisConfig()) return null;
  return json(
    {
      error: 'This shared feature is temporarily unavailable because persistent storage is not configured.',
      code: 'storage_unavailable',
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
    return json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  }

  return null;
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('fly-client-ip') ??
    'unknown'
  );
}

export function getClientIpAddress(request: Request): string {
  return getClientIp(request);
}

async function sign(value: string): Promise<string> {
  if (!APP_SIGNING_SECRET) {
    throw new Error('No signing secret configured.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(APP_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verify(value: string, expected: string): Promise<boolean> {
  const actual = await sign(value);
  return actual === expected;
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

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(bytes));
}

export async function getClientFingerprint(request: Request): Promise<string> {
  return sha256(getClientIp(request));
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
  const key = encodeURIComponent(`community:rate-limit:${feature}:${ipHash}:${bucket}`);

  const incrementResponse = await redisRequest(`incr/${key}`);
  if (!incrementResponse.ok) {
    const details = await incrementResponse.text();
    throw new Error(`Failed to increment rate limit: ${incrementResponse.status} ${details}`);
  }

  const incrementData = (await incrementResponse.json()) as { result?: number };
  const count = typeof incrementData.result === 'number' ? incrementData.result : Number(incrementData.result ?? 0);

  if (count === 1) {
    const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    const expireResponse = await redisRequest(`expire/${key}/${ttlSeconds}`);
    if (!expireResponse.ok) {
      const details = await expireResponse.text();
      throw new Error(`Failed to set rate limit expiry: ${expireResponse.status} ${details}`);
    }
  }

  if (count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil(windowMs / 1000));
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
  return Boolean(import.meta.env.PUBLIC_TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
}

export function isTurnstileChallengeRequired(): boolean {
  return hasTurnstileConfig() && !(isDevelopmentEnv() && TURNSTILE_BYPASS_IN_DEV);
}

export async function verifyTurnstileToken(request: Request, token: string | undefined): Promise<Response | null> {
  if (isDevelopmentEnv() && TURNSTILE_BYPASS_IN_DEV) {
    return null;
  }

  if (!hasTurnstileConfig()) {
    return json(
      {
        error: 'Guestbook posting is unavailable because bot protection is not configured.',
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

  const verificationResponse = await fetch(TURNSTILE_VERIFY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: TURNSTILE_SECRET_KEY!,
      response: token,
      remoteip: getClientIp(request),
    }),
  });

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

export async function createSignedValue(payload: Record<string, unknown>): Promise<string> {
  const body = encodeTextToBase64Url(JSON.stringify(payload));
  const signature = await sign(body);
  return `${body}.${signature}`;
}

export async function readSignedValue<T>(value: string | undefined): Promise<T | null> {
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
