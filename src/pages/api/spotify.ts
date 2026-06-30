import type { APIRoute } from 'astro';
import {
  getCachedSpotifyState,
  setCachedSpotifyState,
} from '../../lib/server/spotify/cache';
import { getSpotifyNowPlayingWithFallback } from '../../lib/server/spotify/service';
import { spotifyJsonResponse } from '../../lib/server/spotify/response';

export const GET: APIRoute = async () => {
  const cached = getCachedSpotifyState();
  if (cached) return spotifyJsonResponse(cached);

  const state = await getSpotifyNowPlayingWithFallback();
  setCachedSpotifyState(state);
  return spotifyJsonResponse(state);
};
