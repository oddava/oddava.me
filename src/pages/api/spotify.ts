import type { APIRoute } from 'astro';
import {
  getCachedNowPlaying,
  getNowPlaying,
  NOW_PLAYING_UNAVAILABLE_MESSAGE,
  nowPlayingResponse,
  setCachedNowPlaying,
  stabilizeNowPlayingState,
} from '../../lib/server/now-playing';

/**
 * Public now-playing feed for the widget. Polled continuously by every open
 * tab, so it is served from an in-process cache and must never throw: a failure
 * here degrades to "nothing playing", never to a 500 on a decorative widget.
 */
export const GET: APIRoute = async () => {
  const cached = getCachedNowPlaying();
  if (cached) return nowPlayingResponse(cached);

  try {
    const state = stabilizeNowPlayingState(await getNowPlaying());
    setCachedNowPlaying(state);
    return nowPlayingResponse(state);
  } catch (error) {
    console.error('[now-playing] request failed', error);
    return nowPlayingResponse({
      isPlaying: false,
      integrations: { spotify: false, lanyard: false },
      error: NOW_PLAYING_UNAVAILABLE_MESSAGE,
    });
  }
};
