import type { SpotifyNowPlaying } from '../../../contracts';
import { IntegrationError, isIntegrationError } from '../errors';
import {
  integrationFetch,
  integrationFetchJson,
  parseIntegrationJson,
} from '../http';
import { credentialFingerprint } from '../../secrets';
import type {
  IntegrationCredentials,
  IntegrationCheckResult,
  IntegrationDefinition,
} from '../types';

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const NOW_PLAYING_ENDPOINT =
  'https://api.spotify.com/v1/me/player/currently-playing';

const LABEL = 'Spotify';
/** Refresh early so a token never expires mid-flight on a slow request. */
const TOKEN_EXPIRY_BUFFER_SECONDS = 300;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

interface SpotifyTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface SpotifyApiPayload {
  is_playing?: boolean;
  progress_ms?: number | null;
  item?: {
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name?: string }>;
    album?: { images?: Array<{ url?: string }> };
    external_urls?: { spotify?: string };
  } | null;
}

interface CachedToken {
  /** Fingerprint of the credentials this token was minted from. */
  fingerprint: string;
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function clearSpotifyTokenCache(): void {
  cachedToken = null;
}

function normalizedTokenLifetime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TOKEN_TTL_SECONDS;
}

function tokenCacheLifetimeMs(expiresInSeconds: number): number {
  // A fixed five-minute buffer is suitable for normal one-hour tokens but
  // would make short-lived tokens expire immediately. For those, retain 90%
  // of the advertised lifetime instead.
  const bufferSeconds = Math.min(
    TOKEN_EXPIRY_BUFFER_SECONDS,
    expiresInSeconds * 0.1,
  );
  return Math.max(0, expiresInSeconds - bufferSeconds) * 1000;
}

function requireCredentials(credentials: IntegrationCredentials): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} {
  const { clientId, clientSecret, refreshToken } = credentials;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new IntegrationError({
      code: 'not_configured',
      message:
        'Spotify client ID, client secret and refresh token are required.',
    });
  }

  return { clientId, clientSecret, refreshToken };
}

async function requestAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const data = await integrationFetchJson<SpotifyTokenResponse>(
    TOKEN_ENDPOINT,
    {
      label: `${LABEL} token`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal,
    },
  ).catch((error: unknown) => {
    // Spotify answers a revoked or rotated refresh token with 400 invalid_grant,
    // which the generic HTTP layer cannot distinguish from a malformed request.
    // Re-classify it so the admin panel tells the operator to re-authorize
    // instead of showing a generic upstream failure that retries forever.
    if (
      isIntegrationError(error) &&
      error.status === 400 &&
      error.message.includes('invalid_grant')
    ) {
      throw new IntegrationError({
        code: 'invalid_credentials',
        message:
          'Spotify rejected the refresh token. It was revoked or has expired — re-authorize and save a new one.',
        status: 400,
        cause: error,
      });
    }
    throw error;
  });

  if (!isRecord(data)) {
    throw new IntegrationError({
      code: 'invalid_response',
      message: 'Spotify returned a non-object token response.',
    });
  }

  if (
    typeof data.access_token !== 'string' ||
    data.access_token.trim().length === 0
  ) {
    throw new IntegrationError({
      code: 'invalid_credentials',
      message:
        (typeof data.error_description === 'string'
          ? data.error_description
          : undefined) ||
        (typeof data.error === 'string' ? data.error : undefined) ||
        'Spotify did not return an access token.',
    });
  }

  return {
    accessToken: data.access_token,
    expiresInSeconds: normalizedTokenLifetime(data.expires_in),
  };
}

/**
 * Returns a valid access token, minting one only when the cached token is
 * missing, expired, or was derived from different credentials. Keying the cache
 * on a credential fingerprint means rotating a secret invalidates the token
 * implicitly — no caller has to remember to clear anything.
 */
async function getAccessToken(
  credentials: IntegrationCredentials,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<string> {
  const { clientId, clientSecret, refreshToken } =
    requireCredentials(credentials);
  const fingerprint = await credentialFingerprint([
    clientId,
    clientSecret,
    refreshToken,
  ]);

  if (
    !options.force &&
    cachedToken &&
    cachedToken.fingerprint === fingerprint &&
    Date.now() < cachedToken.expiresAt
  ) {
    return cachedToken.accessToken;
  }

  // Do not retain an in-flight fetch promise in module scope. Cloudflare may
  // run concurrent requests in different request contexts within one isolate,
  // and sharing request-bound I/O between those contexts is unsafe. The plain
  // token data remains safe to cache after the request has completed.
  const { accessToken, expiresInSeconds } = await requestAccessToken(
    clientId,
    clientSecret,
    refreshToken,
    options.signal,
  );

  cachedToken = {
    fingerprint,
    accessToken,
    expiresAt: Date.now() + tokenCacheLifetimeMs(expiresInSeconds),
  };

  return accessToken;
}

const IDLE: SpotifyNowPlaying = { isPlaying: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidPayload(detail: string): never {
  throw new IntegrationError({
    code: 'invalid_response',
    message: `Spotify returned an invalid now-playing payload: ${detail}.`,
  });
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') invalidPayload(`${field} is not a string`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalidPayload(`${field} is not a non-negative number`);
  }
  return value;
}

function mapPayload(payload: unknown): SpotifyNowPlaying {
  if (!isRecord(payload)) invalidPayload('the response is not an object');

  const item = payload.item;
  if (item === undefined || item === null) return IDLE;
  if (!isRecord(item)) invalidPayload('item is not an object');

  const title = optionalString(item.name, 'item.name');
  if (!title) invalidPayload('item.name is missing');

  if (
    payload.is_playing !== undefined &&
    typeof payload.is_playing !== 'boolean'
  ) {
    invalidPayload('is_playing is not a boolean');
  }

  let artist = '';
  if (item.artists !== undefined) {
    if (!Array.isArray(item.artists)) {
      invalidPayload('item.artists is not an array');
    }
    artist = item.artists
      .map((entry, index) => {
        if (!isRecord(entry)) {
          invalidPayload(`item.artists[${index}] is not an object`);
        }
        return optionalString(entry.name, `item.artists[${index}].name`);
      })
      .filter((name): name is string => Boolean(name))
      .join(', ');
  }

  let albumImageUrl: string | undefined;
  if (item.album !== undefined && item.album !== null) {
    if (!isRecord(item.album)) invalidPayload('item.album is not an object');
    if (item.album.images !== undefined) {
      if (!Array.isArray(item.album.images)) {
        invalidPayload('item.album.images is not an array');
      }
      const image = item.album.images[0];
      if (image !== undefined) {
        if (!isRecord(image)) {
          invalidPayload('item.album.images[0] is not an object');
        }
        albumImageUrl = optionalString(image.url, 'item.album.images[0].url');
      }
    }
  }

  let songUrl: string | undefined;
  if (item.external_urls !== undefined && item.external_urls !== null) {
    if (!isRecord(item.external_urls)) {
      invalidPayload('item.external_urls is not an object');
    }
    songUrl = optionalString(
      item.external_urls.spotify,
      'item.external_urls.spotify',
    );
  }

  return {
    albumImageUrl,
    artist,
    durationMs: optionalNumber(item.duration_ms, 'item.duration_ms'),
    isPlaying: payload.is_playing === true,
    progressMs: optionalNumber(payload.progress_ms, 'progress_ms') ?? 0,
    songUrl,
    title,
  };
}

async function requestNowPlaying(
  accessToken: string,
  signal?: AbortSignal,
): Promise<Response> {
  return integrationFetch(NOW_PLAYING_ENDPOINT, {
    label: `${LABEL} now playing`,
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
}

/**
 * Fetches the currently playing track. A 401 mid-session (token revoked
 * server-side, or expired earlier than advertised) is recovered from once by
 * forcing a refresh; a second 401 is a real credential failure and propagates.
 */
export async function fetchSpotifyNowPlaying(
  credentials: IntegrationCredentials,
  options: { forceTokenRefresh?: boolean; signal?: AbortSignal } = {},
): Promise<SpotifyNowPlaying> {
  let accessToken = await getAccessToken(credentials, {
    force: options.forceTokenRefresh,
    signal: options.signal,
  });

  let response: Response;
  try {
    response = await requestNowPlaying(accessToken, options.signal);
  } catch (error) {
    if (!isIntegrationError(error) || error.code !== 'invalid_credentials') {
      throw error;
    }

    clearSpotifyTokenCache();
    accessToken = await getAccessToken(credentials, {
      force: true,
      signal: options.signal,
    });
    response = await requestNowPlaying(accessToken, options.signal);
  }

  // 204 means "nothing playing", which is a successful, empty answer.
  if (response.status === 204) return IDLE;

  const payload = await parseIntegrationJson<SpotifyApiPayload>(
    response,
    `${LABEL} now playing`,
  );
  return mapPayload(payload);
}

function validateClientId(value: string): string | null {
  return /^[0-9a-f]{32}$/i.test(value)
    ? null
    : 'Expected a 32-character hexadecimal client ID.';
}

function validateClientSecret(value: string): string | null {
  return /^[0-9a-f]{32}$/i.test(value)
    ? null
    : 'Expected a 32-character hexadecimal client secret.';
}

function validateRefreshToken(value: string): string | null {
  // Spotify refresh tokens are long, opaque, and URL-safe base64-ish. Length is
  // the only property worth asserting; anything stricter would reject valid
  // tokens the day Spotify changes its encoding.
  return value.length >= 64
    ? null
    : 'That does not look like a Spotify refresh token (expected 64+ characters).';
}

export const spotifyIntegration: IntegrationDefinition = {
  id: 'spotify',
  name: 'Spotify',
  description:
    'Primary now-playing source. Uses a long-lived refresh token to mint short-lived access tokens.',
  docsUrl: 'https://developer.spotify.com/documentation/web-api',
  manageable: true,
  enabledByDefault: true,
  credentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      kind: 'text',
      required: true,
      envVars: ['SPOTIFY_CLIENT_ID'],
      help: 'From your app in the Spotify developer dashboard.',
      validate: validateClientId,
    },
    {
      key: 'clientSecret',
      label: 'Client secret',
      kind: 'secret',
      required: true,
      envVars: ['SPOTIFY_CLIENT_SECRET'],
      validate: validateClientSecret,
    },
    {
      key: 'refreshToken',
      label: 'Refresh token',
      kind: 'secret',
      required: true,
      envVars: ['SPOTIFY_REFRESH_TOKEN'],
      help: 'Generate with `pnpm run spotify:token`. Requires the user-read-currently-playing scope.',
      validate: validateRefreshToken,
    },
  ],

  onCredentialsChanged: clearSpotifyTokenCache,

  async check(credentials, signal): Promise<IntegrationCheckResult> {
    // Force a refresh so the check exercises the credential that actually
    // rots — the refresh token — rather than a cached access token.
    const state = await fetchSpotifyNowPlaying(credentials, {
      forceTokenRefresh: true,
      signal,
    });

    return {
      state: 'ok',
      detail: state.isPlaying
        ? `Connected. Currently playing “${state.title}”.`
        : 'Connected. Nothing is playing right now.',
    };
  },
};
