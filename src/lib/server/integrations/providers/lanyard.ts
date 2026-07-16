import type { SpotifyNowPlaying } from '../../../contracts';
import { IntegrationError } from '../errors';
import { integrationFetchJson } from '../http';
import type {
  IntegrationCheckResult,
  IntegrationCredentials,
  IntegrationDefinition,
} from '../types';

const LANYARD_ENDPOINT = 'https://api.lanyard.rest/v1/users';
const LABEL = 'Lanyard';

interface LanyardPayload {
  success?: boolean;
  error?: { message?: string; code?: string };
  data?: {
    spotify?: {
      song?: string;
      artist?: string;
      album_art_url?: string;
      track_id?: string;
      timestamps?: { start?: number; end?: number };
    } | null;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidPayload(detail: string): never {
  throw new IntegrationError({
    code: 'invalid_response',
    message: `Lanyard returned an invalid response: ${detail}.`,
  });
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') invalidPayload(`${field} is not a string`);
  return value;
}

function optionalTimestamp(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalidPayload(`${field} is not a valid timestamp`);
  }
  return value;
}

function requireDiscordUserId(credentials: IntegrationCredentials): string {
  const discordUserId = credentials.discordUserId;
  if (!discordUserId) {
    throw new IntegrationError({
      code: 'not_configured',
      message: 'A Discord user ID is required for the Lanyard fallback.',
    });
  }
  return discordUserId;
}

function mapPayload(payload: unknown): SpotifyNowPlaying {
  if (!isRecord(payload)) invalidPayload('the payload is not an object');
  if (!isRecord(payload.data)) invalidPayload('data is not an object');

  const spotify = payload.data.spotify;
  if (spotify === undefined || spotify === null) {
    return { fromFallback: true, isPlaying: false };
  }
  if (!isRecord(spotify)) invalidPayload('data.spotify is not an object');

  const song = optionalString(spotify.song, 'data.spotify.song');
  if (!song) return { fromFallback: true, isPlaying: false };

  let start: number | undefined;
  let end: number | undefined;
  if (spotify.timestamps !== undefined && spotify.timestamps !== null) {
    if (!isRecord(spotify.timestamps)) {
      invalidPayload('data.spotify.timestamps is not an object');
    }
    start = optionalTimestamp(
      spotify.timestamps.start,
      'data.spotify.timestamps.start',
    );
    end = optionalTimestamp(
      spotify.timestamps.end,
      'data.spotify.timestamps.end',
    );
  }

  const trackId = optionalString(spotify.track_id, 'data.spotify.track_id');

  return {
    albumImageUrl: optionalString(
      spotify.album_art_url,
      'data.spotify.album_art_url',
    ),
    artist: optionalString(spotify.artist, 'data.spotify.artist') ?? '',
    durationMs:
      start !== undefined && end !== undefined ? Math.max(0, end - start) : 0,
    fromFallback: true,
    isPlaying: true,
    // Lanyard reports absolute timestamps rather than a progress offset.
    progressMs: start !== undefined ? Math.max(0, Date.now() - start) : 0,
    songUrl: trackId
      ? `https://open.spotify.com/track/${encodeURIComponent(trackId)}`
      : undefined,
    title: song,
  };
}

/**
 * Reads the Discord presence Lanyard exposes for the configured user. Throws an
 * IntegrationError on any failure; the now-playing service decides whether that
 * is fatal or merely means "no fallback available right now".
 */
export async function fetchLanyardNowPlaying(
  credentials: IntegrationCredentials,
  signal?: AbortSignal,
): Promise<SpotifyNowPlaying> {
  const discordUserId = requireDiscordUserId(credentials);

  const payload = await integrationFetchJson<LanyardPayload>(
    `${LANYARD_ENDPOINT}/${encodeURIComponent(discordUserId)}`,
    { label: LABEL, headers: { Accept: 'application/json' }, signal },
  );

  // Lanyard answers an unknown user with HTTP 404 but also with a 200 body
  // carrying `success: false`, so the body has to be checked independently.
  if (!isRecord(payload)) invalidPayload('the payload is not an object');
  if (payload.success === false) {
    const error = isRecord(payload.error) ? payload.error : undefined;
    throw new IntegrationError({
      code: 'not_configured',
      message:
        optionalString(error?.message, 'error.message') ??
        'Lanyard does not track that Discord user. They must join the Lanyard Discord server first.',
    });
  }
  if (payload.success !== true) invalidPayload('success is not a boolean');

  return mapPayload(payload);
}

export const lanyardIntegration: IntegrationDefinition = {
  id: 'lanyard',
  name: 'Lanyard',
  description:
    'Fallback now-playing source via Discord presence. Used when Spotify reports nothing playing or is unreachable.',
  docsUrl: 'https://github.com/Phineas/lanyard',
  manageable: true,
  enabledByDefault: true,
  credentials: [
    {
      key: 'discordUserId',
      label: 'Discord user ID',
      kind: 'text',
      required: true,
      envVars: [
        'DISCORD_USER_ID',
        'LANYARD_DISCORD_USER_ID',
        'SPOTIFY_DISCORD_USER_ID',
      ],
      help: 'Enable developer mode in Discord, then right-click your name and copy the user ID. You must also be in the Lanyard Discord server.',
    },
  ],

  async check(credentials, signal): Promise<IntegrationCheckResult> {
    const state = await fetchLanyardNowPlaying(credentials, signal);

    return {
      state: 'ok',
      detail: state.isPlaying
        ? `Connected. Discord presence reports “${state.title}”.`
        : 'Connected. Discord presence reports no Spotify activity.',
    };
  },
};
