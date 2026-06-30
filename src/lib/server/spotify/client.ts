import type { SpotifyNowPlaying } from '../../contracts';
import { fetchWithTimeout } from '../community';
import { getServerEnv } from '../env';
import type { SpotifyApiPayload, SpotifyTokenResponse } from './types';

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const NOW_PLAYING_ENDPOINT =
  'https://api.spotify.com/v1/me/player/currently-playing';
const TOKEN_EXPIRATION_BUFFER_SECONDS = 300;
const MIN_TOKEN_TTL_SECONDS = 60;

let cachedAccessToken: string | null = null;
let tokenExpirationTime = 0;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpirationTime) {
    return cachedAccessToken;
  }

  const clientId = getServerEnv('SPOTIFY_CLIENT_ID');
  const clientSecret = getServerEnv('SPOTIFY_CLIENT_SECRET');
  const refreshToken = getServerEnv('SPOTIFY_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Spotify credentials are missing.');
  }

  const response = await fetchWithTimeout(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = (await response.json()) as SpotifyTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description ||
        data.error ||
        'Could not refresh Spotify access token.',
    );
  }

  cachedAccessToken = data.access_token;
  tokenExpirationTime =
    Date.now() +
    Math.max(
      MIN_TOKEN_TTL_SECONDS,
      (data.expires_in ?? 3600) - TOKEN_EXPIRATION_BUFFER_SECONDS,
    ) *
      1000;

  return cachedAccessToken;
}

function mapSpotifyPayload(
  payload: SpotifyApiPayload | null,
): SpotifyNowPlaying | null {
  if (!payload?.item?.name || !payload.item.duration_ms) {
    return null;
  }

  return {
    albumImageUrl: payload.item.album?.images?.[0]?.url,
    artist:
      payload.item.artists
        ?.map((item) => item.name)
        .filter(Boolean)
        .join(', ') ?? '',
    durationMs: payload.item.duration_ms,
    isPlaying: Boolean(payload.is_playing),
    progressMs: payload.progress_ms ?? 0,
    songUrl: payload.item.external_urls?.spotify,
    title: payload.item.name,
  };
}

export async function fetchSpotifyNowPlaying(): Promise<SpotifyNowPlaying | null> {
  const accessToken = await getAccessToken();
  const response = await fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 204 || !response.ok) {
    console.log('Spotify status:', response.status);
    return null;
  }

  const text = await response.text();
  return mapSpotifyPayload(
    text ? (JSON.parse(text) as SpotifyApiPayload) : null,
  );
}
