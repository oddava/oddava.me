import type { AstroCookies } from 'astro';
import { getServerEnv } from '../env';
import { hasSigningSecret, isSecureRequest, json } from '../core';
import { firstConfiguredSecret } from '../secrets';
import { signHmac } from '../crypto';
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  constantTimeCompare,
  computeTokenHash,
  createSignedSessionValue,
  verifySession,
  type AdminSession,
} from './auth-shared';
import { withAdminSecurityHeaders } from './response';

function getAdminToken(): string | null {
  return (
    firstConfiguredSecret(
      getServerEnv('ADMIN_PANEL_TOKEN'),
      getServerEnv('GUESTBOOK_ADMIN_TOKEN'),
    ) ?? null
  );
}

function getSigningSecret(): string | null {
  return (
    firstConfiguredSecret(getServerEnv('COMMUNITY_SIGNING_SECRET')) ?? null
  );
}

function requireSigningSecret(): string {
  const secret = getSigningSecret();
  if (!secret) throw new Error('COMMUNITY_SIGNING_SECRET is not configured.');
  return secret;
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

export function isAdminConfigured(): boolean {
  return Boolean(getAdminToken()) && hasSigningSecret();
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  const configured = getAdminToken();
  if (!configured) return false;
  return constantTimeCompare(
    await computeTokenHash(token),
    await computeTokenHash(configured),
  );
}

// What the cookie records about the admin token. Keyed under the signing
// secret, so the cookie body carries no offline-guessable digest of
// ADMIN_PANEL_TOKEN: recovering the token from it means forging an HMAC.
// Deriving it in one place is what keeps the mint below and the rotation check
// in `isAdminRequest` agreeing.
function tokenBinding(token: string, secret: string): Promise<string> {
  return signHmac(token, secret);
}

export async function createAdminSessionValue(token: string): Promise<string> {
  const secret = requireSigningSecret();
  return createSignedSessionValue(
    {
      role: 'admin',
      tokenBinding: await tokenBinding(token, secret),
      issuedAt: Date.now(),
    } satisfies AdminSession,
    secret,
  );
}

export async function isAdminRequest(cookies: AstroCookies): Promise<boolean> {
  const configured = getAdminToken();
  if (!configured) return false;
  const secret = getSigningSecret();
  if (!secret) return false;

  const session = await verifySession(cookies.get(ADMIN_COOKIE)?.value, secret);
  if (!session) return false;

  // Rotating ADMIN_PANEL_TOKEN changes this binding, so a session minted
  // against the retired token stops verifying even though its signature is
  // still intact.
  return constantTimeCompare(
    session.tokenBinding,
    await tokenBinding(configured, secret),
  );
}

async function requireAdminApi(
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
