import type { AstroCookies } from 'astro';
import { getServerEnv } from '../env';
import { hasCommunitySigningSecret, isSecureRequest, json } from '../community';
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  constantTimeCompare,
  computeTokenHash,
  createSignedSessionValue,
  parseSessionValue,
  type AdminSession,
} from './auth-shared';
import { withAdminSecurityHeaders } from './response';

// Re-export the shared primitives so existing callers of `auth.ts` keep
// working without changing their import sites.
export {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  ADMIN_SESSION_TTL_MS,
  computeTokenHash,
  constantTimeCompare,
  parseSessionValue,
  verifySession,
  signSessionValue,
  verifySessionSignature,
  createSignedSessionValue,
  bytesToBase64Url,
  base64UrlToBytes,
  encodeTextToBase64Url,
  decodeBase64UrlToText,
  type AdminSession,
} from './auth-shared';

function getAdminToken(): string | null {
  return (
    getServerEnv('ADMIN_PANEL_TOKEN') ??
    getServerEnv('GUESTBOOK_ADMIN_TOKEN') ??
    null
  );
}

function getSigningSecret(): string | null {
  return getServerEnv('COMMUNITY_SIGNING_SECRET')?.trim() || null;
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
  return constantTimeCompare(
    await computeTokenHash(token),
    await computeTokenHash(configured),
  );
}

export async function createAdminSessionValue(token: string): Promise<string> {
  return createSignedSessionValue(
    {
      role: 'admin',
      tokenHash: await computeTokenHash(token),
      issuedAt: Date.now(),
    } satisfies AdminSession,
    getSigningSecret() ?? '',
  );
}

export async function isAdminRequest(cookies: AstroCookies): Promise<boolean> {
  const configured = getAdminToken();
  if (!configured) return false;
  const secret = getSigningSecret();
  if (!secret) return false;

  const session = await parseSessionValue(
    cookies.get(ADMIN_COOKIE)?.value,
    secret,
  );
  if (!session) return false;

  const ageMs = Date.now() - session.issuedAt;
  if (
    !Number.isFinite(ageMs) ||
    ageMs < 0 ||
    ageMs > ADMIN_SESSION_TTL_SECONDS * 1000
  ) {
    return false;
  }

  return constantTimeCompare(
    session.tokenHash,
    await computeTokenHash(configured),
  );
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
