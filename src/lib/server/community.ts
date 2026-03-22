import type { AstroCookies } from 'astro';
import { Buffer } from 'node:buffer';

const REDIS_API_URL =
  import.meta.env.UPSTASH_REDIS_REST_URL ??
  import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
const REDIS_API_TOKEN =
  import.meta.env.UPSTASH_REDIS_REST_TOKEN ??
  import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;

const APP_SIGNING_SECRET =
  import.meta.env.COMMUNITY_SIGNING_SECRET ??
  import.meta.env.KEYSTATIC_SECRET ??
  REDIS_API_TOKEN;

export function hasRedisConfig(): boolean {
  return Boolean(REDIS_API_URL && REDIS_API_TOKEN);
}

export async function redisRequest(command: string): Promise<Response> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
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

export function ensureSameOrigin(request: Request): Response | null {
  const requestOrigin = new URL(request.url).origin;
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
  return Buffer.from(signature).toString('base64url');
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

export async function createSignedValue(payload: Record<string, unknown>): Promise<string> {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
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
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
