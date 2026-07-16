import type { SpotifyIntegrations, SpotifyNowPlaying } from '../../contracts';
import {
  fetchLanyardNowPlaying,
  lanyardIntegration,
  fetchSpotifyNowPlaying,
  isIntegrationUsable,
  resolveCredentials,
  spotifyIntegration,
  type IntegrationDefinition,
} from '../integrations';

const IDLE: SpotifyNowPlaying = { isPlaying: false };

/**
 * Upstream failures are reported to visitors as a single opaque message. The
 * specific reason (a rejected refresh token, a rate limit, an unknown Discord
 * user) is operator-facing and is surfaced through the admin status API
 * instead — a public endpoint has no business narrating our credential state.
 */
export const NOW_PLAYING_UNAVAILABLE_MESSAGE =
  'Now playing is temporarily unavailable.';

/**
 * Reads a provider, containing any failure. A failing provider is not recorded
 * anywhere: the response cache in `cache.ts` already bounds how often this runs,
 * and the operator learns about the failure from the admin panel's own check.
 */
async function readProvider(
  definition: IntegrationDefinition,
  read: (
    credentials: Awaited<ReturnType<typeof resolveCredentials>>,
  ) => Promise<SpotifyNowPlaying>,
): Promise<{ state: SpotifyNowPlaying } | { failed: true }> {
  try {
    const credentials = await resolveCredentials(definition);
    return { state: await read(credentials) };
  } catch (error) {
    console.error(`[now-playing] ${definition.id} read failed`, error);
    return { failed: true };
  }
}

async function resolveAvailability(): Promise<SpotifyIntegrations> {
  const [spotify, lanyard] = await Promise.all([
    isIntegrationUsable(spotifyIntegration),
    isIntegrationUsable(lanyardIntegration),
  ]);

  return { spotify, lanyard };
}

/**
 * Resolves the current track, preferring Spotify and falling back to Discord
 * presence via Lanyard. Never throws: a now-playing widget is decoration, and
 * must not be able to fail a page.
 */
export async function getNowPlaying(): Promise<SpotifyNowPlaying> {
  const integrations = await resolveAvailability();

  if (!integrations.spotify && !integrations.lanyard) {
    return { ...IDLE, integrations };
  }

  let spotifyState: SpotifyNowPlaying | null = null;
  let failed = false;
  let succeeded = false;

  if (integrations.spotify) {
    const result = await readProvider(spotifyIntegration, (credentials) =>
      fetchSpotifyNowPlaying(credentials),
    );

    if ('failed' in result) {
      failed = true;
    } else {
      succeeded = true;
      spotifyState = result.state;
      // A playing track from the primary source is the best possible answer;
      // there is nothing the fallback could improve on.
      if (spotifyState.isPlaying) {
        return { ...spotifyState, source: 'spotify', integrations };
      }
    }
  }

  if (integrations.lanyard) {
    const result = await readProvider(
      lanyardIntegration,
      fetchLanyardNowPlaying,
    );

    if ('failed' in result) {
      failed = true;
    } else {
      succeeded = true;
      if (result.state.isPlaying) {
        return {
          ...result.state,
          fromFallback: true,
          source: 'lanyard',
          integrations,
        };
      }
    }
  }

  // Spotify answered, just with nothing playing. That is a real answer, and it
  // outranks the fallback's silence.
  if (spotifyState) {
    return { ...spotifyState, source: 'spotify', integrations };
  }

  return {
    ...IDLE,
    integrations,
    // Only claim an error if every source we actually tried failed. If they
    // simply had nothing to report, idle is the truth.
    ...(failed && !succeeded ? { error: NOW_PLAYING_UNAVAILABLE_MESSAGE } : {}),
  };
}
