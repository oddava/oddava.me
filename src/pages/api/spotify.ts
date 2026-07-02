import type { APIRoute } from 'astro';
import { getIntegrationSettings } from '../../lib/server/admin/settings';
import {
  clearCachedSpotifyState,
  getCachedSpotifyState,
  setCachedSpotifyState,
} from '../../lib/server/spotify/cache';
import { getSpotifyNowPlayingWithFallback } from '../../lib/server/spotify/service';
import { spotifyJsonResponse } from '../../lib/server/spotify/response';

export const GET: APIRoute = async () => {
  const settings = await getIntegrationSettings();

  if (!settings.integrations.spotify) {
    clearCachedSpotifyState();
    return new Response(
      JSON.stringify({
        isPlaying: false,
        integrations: { spotify: false, lanyard: false },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  const cached = getCachedSpotifyState();
  if (cached) return spotifyJsonResponse(cached);

  const state = await getSpotifyNowPlayingWithFallback();
  setCachedSpotifyState(state);
  return spotifyJsonResponse(state);
};
