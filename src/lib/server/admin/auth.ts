import type { AstroCookies } from 'astro';
import { getServerEnv } from '../env';
import {
  createSignedValue,
  hasCommunitySigningSecret,
  isSecureRequest,
  json,
  readSignedValue,
} from '../community';
import { withAdminSecurityHeaders } from './response';

const ADMIN_COOKIE = 'oddava-admin-session';
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

interface AdminSession {
  role: 'admin';
  tokenHash: string;
  issuedAt: number;
}

function getAdminToken(): string | null {
  return (
    getServerEnv('ADMIN_PANEL_TOKEN') ??
    getServerEnv('GUESTBOOK_ADMIN_TOKEN') ??
    null
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function getCookieOptions(
  request: Request,
): Parameters<AstroCookies['set']>[2] {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureRequest(request),
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  };
}

export function getAdminCookieName(): string {
  return ADMIN_COOKIE;
}

export function isAdminConfigured(): boolean {
  return Boolean(getAdminToken()) && hasCommunitySigningSecret();
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  const configured = getAdminToken();
  if (!configured) return false;
  return constantTimeEqual(await sha256Hex(token), await sha256Hex(configured));
}

export async function createAdminSessionValue(token: string): Promise<string> {
  return createSignedValue({
    role: 'admin',
    tokenHash: await sha256Hex(token),
    issuedAt: Date.now(),
  } satisfies AdminSession);
}

export async function isAdminRequest(cookies: AstroCookies): Promise<boolean> {
  const configured = getAdminToken();
  if (!configured) return false;

  const session = await readSignedValue<AdminSession>(
    cookies.get(ADMIN_COOKIE)?.value,
  );
  if (!session || session.role !== 'admin' || !session.tokenHash) return false;
  const ageMs = Date.now() - session.issuedAt;
  if (
    !Number.isFinite(ageMs) ||
    ageMs < 0 ||
    ageMs > ADMIN_SESSION_TTL_SECONDS * 1000
  ) {
    return false;
  }

  return constantTimeEqual(session.tokenHash, await sha256Hex(configured));
}

export async function requireAdminApi(
  cookies: AstroCookies,
): Promise<Response | null> {
  if (await isAdminRequest(cookies)) return null;
  return json(
    { error: 'Unauthorized.', code: 'unauthorized' },
    { status: 401 },
  );
}

export async function requireSecuredAdminApi(
  cookies: AstroCookies,
): Promise<Response | null> {
  const authError = await requireAdminApi(cookies);
  return authError ? withAdminSecurityHeaders(authError) : null;
}

export function setAdminSession(
  cookies: AstroCookies,
  request: Request,
  value: string,
): void {
  cookies.set(ADMIN_COOKIE, value, getCookieOptions(request));
}

export function clearAdminSession(
  cookies: AstroCookies,
  request: Request,
): void {
  cookies.set(ADMIN_COOKIE, '', {
    ...getCookieOptions(request),
    maxAge: 0,
  });
}
