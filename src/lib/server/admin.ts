import type { AstroCookies } from 'astro';
import { getServerEnv } from './env';
import {
  createSignedValue,
  hasCommunitySigningSecret,
  hasRedisConfig,
  hasTurnstileConfig,
  isSecureRequest,
  json,
  readSignedValue,
} from './community';

const ADMIN_COOKIE = 'oddava-admin-session';
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

interface AdminSession {
  role: 'admin';
  tokenHash: string;
  issuedAt: number;
}

function getAdminToken(): string | null {
  return getServerEnv('ADMIN_PANEL_TOKEN') ?? getServerEnv('GUESTBOOK_ADMIN_TOKEN') ?? null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
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

function getCookieOptions(request: Request): Parameters<AstroCookies['set']>[2] {
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

  const session = await readSignedValue<AdminSession>(cookies.get(ADMIN_COOKIE)?.value);
  if (!session || session.role !== 'admin' || !session.tokenHash) return false;
  const ageMs = Date.now() - session.issuedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ADMIN_SESSION_TTL_SECONDS * 1000) {
    return false;
  }

  return constantTimeEqual(session.tokenHash, await sha256Hex(configured));
}

export async function requireAdminApi(cookies: AstroCookies): Promise<Response | null> {
  if (await isAdminRequest(cookies)) return null;
  return json({ error: 'Unauthorized.', code: 'unauthorized' }, { status: 401 });
}

export function setAdminSession(cookies: AstroCookies, request: Request, value: string): void {
  cookies.set(ADMIN_COOKIE, value, getCookieOptions(request));
}

export function clearAdminSession(cookies: AstroCookies, request: Request): void {
  cookies.set(ADMIN_COOKIE, '', {
    ...getCookieOptions(request),
    maxAge: 0,
  });
}

export interface AdminIntegrationStatus {
  name: string;
  healthy: boolean;
  detail: string;
}

export async function getAdminIntegrationStatuses(): Promise<AdminIntegrationStatus[]> {
  const statuses: AdminIntegrationStatus[] = [];

  statuses.push({
    name: 'Storage',
    healthy: hasRedisConfig(),
    detail: hasRedisConfig() ? 'Redis-backed shared features are writable.' : 'Redis is not configured.',
  });

  statuses.push({
    name: 'Turnstile',
    healthy: hasTurnstileConfig(),
    detail: hasTurnstileConfig() ? 'Guestbook bot protection is configured.' : 'Guestbook posting protection is unavailable.',
  });

  const keystaticMode = import.meta.env.PROD ? 'GitHub storage' : 'Local storage';
  statuses.push({
    name: 'Keystatic',
    healthy: true,
    detail: `Configured in ${keystaticMode} mode.`,
  });

  const aniListUsername = getServerEnv('ANILIST_USERNAME') ?? 'codeJ';
  const aniListConfigured = Boolean(aniListUsername);
  statuses.push({
    name: 'AniList',
    healthy: aniListConfigured,
    detail: aniListConfigured
      ? `Favorites source configured for ${aniListUsername}.`
      : 'AniList integration is not configured.',
  });

  const spotifyConfigured = Boolean(
    getServerEnv('SPOTIFY_CLIENT_ID') &&
      getServerEnv('SPOTIFY_CLIENT_SECRET') &&
      getServerEnv('SPOTIFY_REFRESH_TOKEN'),
  ) || Boolean(getServerEnv('DISCORD_USER_ID'));

  statuses.push({
    name: 'Spotify',
    healthy: spotifyConfigured,
    detail: spotifyConfigured
      ? 'Spotify or fallback presence integration is configured.'
      : 'Spotify credentials and Discord fallback are both missing.',
  });

  statuses.push({
    name: 'Signing secret',
    healthy: hasCommunitySigningSecret(),
    detail: hasCommunitySigningSecret()
      ? 'Dedicated session signing secret is configured.'
      : 'COMMUNITY_SIGNING_SECRET is missing.',
  });

  statuses.push({
    name: 'Admin auth',
    healthy: isAdminConfigured(),
    detail: isAdminConfigured()
      ? 'Admin token and signing secret are configured.'
      : 'ADMIN_PANEL_TOKEN and COMMUNITY_SIGNING_SECRET are both required.',
  });

  return statuses;
}
