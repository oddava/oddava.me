import {
  hasCommunitySigningSecret,
  hasRedisConfig,
  hasTurnstileConfig,
} from '../community';
import { getServerEnv } from '../env';
import { isAdminConfigured } from './auth';

export interface AdminIntegrationStatus {
  name: string;
  healthy: boolean;
  detail: string;
}

export async function getAdminIntegrationStatuses(): Promise<
  AdminIntegrationStatus[]
> {
  const statuses: AdminIntegrationStatus[] = [];

  statuses.push({
    name: 'Storage',
    healthy: hasRedisConfig(),
    detail: hasRedisConfig()
      ? 'Redis-backed shared features are writable.'
      : 'Redis is not configured.',
  });

  statuses.push({
    name: 'Turnstile',
    healthy: hasTurnstileConfig(),
    detail: hasTurnstileConfig()
      ? 'Guestbook bot protection is configured.'
      : 'Guestbook posting protection is unavailable.',
  });

  const keystaticMode = import.meta.env.PROD
    ? 'GitHub storage'
    : 'Local storage';
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

  const spotifyConfigured =
    Boolean(
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
