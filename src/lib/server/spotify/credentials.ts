import { hasRedisConfig, redisCommand } from '../community';
import { getServerEnv } from '../env';
import { SITE_DISCORD_USER_ID } from '../../site';

const CREDENTIALS_KEY = 'admin:spotify-credentials';

export function isConfiguredSecret(value: string | undefined): boolean {
  if (!value?.trim()) return false;

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('your_')) return false;
  if (normalized.endsWith('_here')) return false;

  return true;
}

export interface SpotifyCredentials {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

export interface LanyardCredentials {
  discordUserId?: string;
}

export interface SpotifyCredentialsRecord {
  spotify: SpotifyCredentials;
  lanyard: LanyardCredentials;
}

export type CredentialSource = 'override' | 'env' | 'default' | 'none';

export interface CredentialFieldStatus {
  set: boolean;
  source: CredentialSource;
}

export interface SpotifyCredentialsStatus {
  spotify: {
    clientId: CredentialFieldStatus;
    clientSecret: CredentialFieldStatus;
    refreshToken: CredentialFieldStatus;
  };
  lanyard: {
    discordUserId: CredentialFieldStatus;
  };
}

const EMPTY_RECORD: SpotifyCredentialsRecord = {
  spotify: {},
  lanyard: {},
};

function firstConfiguredSecret(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find(isConfiguredSecret);
}

function envCredentials(): SpotifyCredentialsRecord {
  const discordUserId =
    getServerEnv('DISCORD_USER_ID') ??
    getServerEnv('LANYARD_DISCORD_USER_ID') ??
    getServerEnv('SPOTIFY_DISCORD_USER_ID');

  return {
    spotify: {
      clientId: getServerEnv('SPOTIFY_CLIENT_ID'),
      clientSecret: getServerEnv('SPOTIFY_CLIENT_SECRET'),
      refreshToken: getServerEnv('SPOTIFY_REFRESH_TOKEN'),
    },
    lanyard: {
      discordUserId,
    },
  };
}

async function readRedisRecord(): Promise<SpotifyCredentialsRecord> {
  if (!hasRedisConfig()) return EMPTY_RECORD;

  try {
    const raw = await redisCommand<string | null>(['GET', CREDENTIALS_KEY]);
    if (!raw) return EMPTY_RECORD;

    const parsed = JSON.parse(raw) as Partial<SpotifyCredentialsRecord>;
    return {
      spotify: {
        clientId: parsed.spotify?.clientId,
        clientSecret: parsed.spotify?.clientSecret,
        refreshToken: parsed.spotify?.refreshToken,
      },
      lanyard: {
        discordUserId: parsed.lanyard?.discordUserId,
      },
    };
  } catch {
    return EMPTY_RECORD;
  }
}

export async function getSpotifyCredentials(): Promise<SpotifyCredentialsRecord> {
  const redis = await readRedisRecord();
  const env = envCredentials();

  return {
    spotify: {
      clientId: firstConfiguredSecret(
        redis.spotify.clientId,
        env.spotify.clientId,
      ),
      clientSecret: firstConfiguredSecret(
        redis.spotify.clientSecret,
        env.spotify.clientSecret,
      ),
      refreshToken: firstConfiguredSecret(
        redis.spotify.refreshToken,
        env.spotify.refreshToken,
      ),
    },
    lanyard: {
      discordUserId: firstConfiguredSecret(
        redis.lanyard.discordUserId,
        env.lanyard.discordUserId,
        SITE_DISCORD_USER_ID,
      ),
    },
  };
}

function fieldSource(
  redisValue: string | undefined,
  envValue: string | undefined,
  defaultValue?: string,
): CredentialFieldStatus {
  if (isConfiguredSecret(redisValue)) {
    return { set: true, source: 'override' };
  }
  if (isConfiguredSecret(envValue)) {
    return { set: true, source: 'env' };
  }
  if (isConfiguredSecret(defaultValue)) {
    return { set: true, source: 'default' };
  }
  return { set: false, source: 'none' };
}

export async function getSpotifyCredentialsStatus(): Promise<SpotifyCredentialsStatus> {
  const redis = await readRedisRecord();
  const env = envCredentials();

  return {
    spotify: {
      clientId: fieldSource(redis.spotify.clientId, env.spotify.clientId),
      clientSecret: fieldSource(
        redis.spotify.clientSecret,
        env.spotify.clientSecret,
      ),
      refreshToken: fieldSource(
        redis.spotify.refreshToken,
        env.spotify.refreshToken,
      ),
    },
    lanyard: {
      discordUserId: fieldSource(
        redis.lanyard.discordUserId,
        env.lanyard.discordUserId,
        SITE_DISCORD_USER_ID,
      ),
    },
  };
}

function trimField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export async function updateSpotifyCredentials(
  patch: Partial<{
    spotify: Partial<SpotifyCredentials>;
    lanyard: Partial<LanyardCredentials>;
  }>,
): Promise<SpotifyCredentialsRecord> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }

  const current = await readRedisRecord();
  const spotify = { ...current.spotify };
  const lanyard = { ...current.lanyard };

  if (patch.spotify) {
    if (patch.spotify.clientId !== undefined) {
      spotify.clientId = trimField(patch.spotify.clientId);
    }
    if (patch.spotify.clientSecret !== undefined) {
      spotify.clientSecret = trimField(patch.spotify.clientSecret);
    }
    if (patch.spotify.refreshToken !== undefined) {
      spotify.refreshToken = trimField(patch.spotify.refreshToken);
    }
  }

  if (patch.lanyard) {
    if (patch.lanyard.discordUserId !== undefined) {
      lanyard.discordUserId = trimField(patch.lanyard.discordUserId);
    }
  }

  const next: SpotifyCredentialsRecord = { spotify, lanyard };
  await redisCommand(['SET', CREDENTIALS_KEY, JSON.stringify(next)]);
  return next;
}

export async function clearSpotifyCredentials(): Promise<void> {
  if (!hasRedisConfig()) return;
  await redisCommand(['DEL', CREDENTIALS_KEY]);
}
