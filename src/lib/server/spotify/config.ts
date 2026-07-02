import type { SpotifyIntegrations, SpotifyNowPlaying } from '../../contracts';
import type { SpotifyCredentialsRecord } from './credentials';
import { getSpotifyCredentials, isConfiguredSecret } from './credentials';

export { isConfiguredSecret };

export const SPOTIFY_UNAVAILABLE: SpotifyNowPlaying = { isPlaying: false };

export async function getSpotifyIntegrations(
  creds?: SpotifyCredentialsRecord,
): Promise<SpotifyIntegrations> {
  const c = creds ?? (await getSpotifyCredentials());
  return {
    spotify:
      isConfiguredSecret(c.spotify.clientId) &&
      isConfiguredSecret(c.spotify.clientSecret) &&
      isConfiguredSecret(c.spotify.refreshToken),
    lanyard: isConfiguredSecret(c.lanyard.discordUserId),
  };
}

export function hasAnySpotifyIntegration(
  integrations: SpotifyIntegrations,
): boolean {
  return integrations.spotify || integrations.lanyard;
}

export async function isSpotifyConfigured(
  creds?: SpotifyCredentialsRecord,
): Promise<boolean> {
  const c = creds ?? (await getSpotifyCredentials());
  return (
    isConfiguredSecret(c.spotify.clientId) &&
    isConfiguredSecret(c.spotify.clientSecret) &&
    isConfiguredSecret(c.spotify.refreshToken)
  );
}

export async function isLanyardConfigured(
  creds?: SpotifyCredentialsRecord,
): Promise<boolean> {
  const c = creds ?? (await getSpotifyCredentials());
  return isConfiguredSecret(c.lanyard.discordUserId);
}
