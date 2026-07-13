// Public surface of the now-playing domain: composes the Spotify and Lanyard
// integrations into a single state for the widget.
export {
  getCachedNowPlaying,
  setCachedNowPlaying,
  stabilizeNowPlayingState,
} from './now-playing/cache';
export { nowPlayingResponse } from './now-playing/response';
export {
  getNowPlaying,
  NOW_PLAYING_UNAVAILABLE_MESSAGE,
} from './now-playing/service';
