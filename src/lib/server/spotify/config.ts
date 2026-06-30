import type { SpotifyIntegrations, SpotifyNowPlaying } from '../../contracts';
import { getServerEnv } from '../env';

export const SPOTIFY_UNAVAILABLE: SpotifyNowPlaying = { isPlaying: false };

export function getSpotifyIntegrations(): SpotifyIntegrations {
  return {
    spotify: isSpotifyConfigured(),
    lanyard: isLanyardConfigured(),
  };
}

export function hasAnySpotifyIntegration(
  integrations: SpotifyIntegrations = getSpotifyIntegrations(),
): boolean {
  return integrations.spotify || integrations.lanyard;
}

function isConfiguredSecret(value: string | undefined): boolean {
  if (!value?.trim()) return false;

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('your_')) return false;
  if (normalized.endsWith('_here')) return false;

  return true;
}

export function isSpotifyConfigured(): boolean {
  return (
    isConfiguredSecret(getServerEnv('SPOTIFY_CLIENT_ID')) &&
    isConfiguredSecret(getServerEnv('SPOTIFY_CLIENT_SECRET')) &&
    isConfiguredSecret(getServerEnv('SPOTIFY_REFRESH_TOKEN'))
  );
}

export function isLanyardConfigured(): boolean {
  return isConfiguredSecret(getServerEnv('DISCORD_USER_ID'));
}