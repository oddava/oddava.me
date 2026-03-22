import type { AstroCookies } from 'astro';
import { createSignedValue, hasRedisConfig, hasTurnstileConfig, json, readSignedValue } from './community';

const ADMIN_COOKIE = 'oddava-admin-session';
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

interface AdminSession {
  role: 'admin';
  tokenHash: string;
  issuedAt: number;
}

function getAdminToken(): string | null {
  return import.meta.env.ADMIN_PANEL_TOKEN ?? import.meta.env.GUESTBOOK_ADMIN_TOKEN ?? null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function getCookieOptions(requestUrl: string): Parameters<AstroCookies['set']>[2] {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(requestUrl).protocol === 'https:',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  };
}

export function getAdminCookieName(): string {
  return ADMIN_COOKIE;
}

export function isAdminConfigured(): boolean {
  return Boolean(getAdminToken());
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  const configured = getAdminToken();
  if (!configured) return false;
  return token === configured;
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

  return session.tokenHash === (await sha256Hex(configured));
}

export async function requireAdminApi(cookies: AstroCookies): Promise<Response | null> {
  if (await isAdminRequest(cookies)) return null;
  return json({ error: 'Unauthorized.', code: 'unauthorized' }, { status: 401 });
}

export function setAdminSession(cookies: AstroCookies, requestUrl: string, value: string): void {
  cookies.set(ADMIN_COOKIE, value, getCookieOptions(requestUrl));
}

export function clearAdminSession(cookies: AstroCookies, requestUrl: string): void {
  cookies.set(ADMIN_COOKIE, '', {
    ...getCookieOptions(requestUrl),
    maxAge: 0,
  });
}

export function redirectToAdminLogin(currentPath: string): Response {
  const location = currentPath && currentPath !== '/admin/login'
    ? `/admin/login?next=${encodeURIComponent(currentPath)}`
    : '/admin/login';
  return new Response(null, {
    status: 302,
    headers: { Location: location },
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

  const aniShowsConfigured = Boolean(import.meta.env.ANISHOWS_API_BASE_URL ?? 'https://anishows.com/api/v1');
  statuses.push({
    name: 'AniShows',
    healthy: aniShowsConfigured,
    detail: aniShowsConfigured
      ? `Favorites source configured for ${import.meta.env.ANISHOWS_USERNAME ?? 'oddava'}.`
      : 'AniShows integration is not configured.',
  });

  const spotifyConfigured = Boolean(
    import.meta.env.SPOTIFY_CLIENT_ID &&
      import.meta.env.SPOTIFY_CLIENT_SECRET &&
      import.meta.env.SPOTIFY_REFRESH_TOKEN,
  ) || Boolean(import.meta.env.DISCORD_USER_ID);

  statuses.push({
    name: 'Spotify',
    healthy: spotifyConfigured,
    detail: spotifyConfigured
      ? 'Spotify or fallback presence integration is configured.'
      : 'Spotify credentials and Discord fallback are both missing.',
  });

  statuses.push({
    name: 'Admin auth',
    healthy: isAdminConfigured(),
    detail: isAdminConfigured() ? 'Shared admin token is configured.' : 'ADMIN_PANEL_TOKEN is missing.',
  });

  return statuses;
}
