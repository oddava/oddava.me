import { getServerEnv } from '../env';
import { checkSpotifyConnection } from '../spotify/service';
import { getIntegrationSettings } from './settings';

export interface AdminIntegrationStatus {
  name: string;
  key?: string;
  healthy: boolean;
  detail: string;
  manageable?: boolean;
  enabled?: boolean;
}

export async function getAdminIntegrationStatuses(): Promise<
  AdminIntegrationStatus[]
> {
  const settings = await getIntegrationSettings();

  const aniListUsername = getServerEnv('ANILIST_USERNAME') ?? 'codeJ';
  const aniListConfigured = Boolean(aniListUsername);

  const spotifyEnabled = settings.integrations.spotify;
  const spotifyCheck = spotifyEnabled ? await checkSpotifyConnection() : null;

  return [
    {
      name: 'AniList',
      key: 'anilist',
      healthy: aniListConfigured,
      detail: aniListConfigured
        ? `Favorites source configured for ${aniListUsername}.`
        : 'AniList integration is not configured.',
      manageable: false,
    },
    {
      name: 'Spotify',
      key: 'spotify',
      healthy: spotifyCheck?.healthy ?? false,
      detail: spotifyCheck
        ? spotifyCheck.detail
        : 'Spotify integration is disabled. Enable to check the connection.',
      manageable: true,
      enabled: spotifyEnabled,
    },
  ];
}
