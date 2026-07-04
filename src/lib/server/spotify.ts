// Public surface for the spotify domain. Re-exports only the names currently
// imported from outside `src/lib/server/spotify/`. Existing direct imports
// are left untouched; this barrel exists for future convenience.
export {
  checkSpotifyConnection,
  getSpotifyNowPlayingWithFallback,
  type SpotifyConnectionCheck,
} from './spotify/service';
export {
  clearCachedSpotifyState,
  getCachedSpotifyState,
  setCachedSpotifyState,
  stabilizeNowPlayingState,
} from './spotify/cache';
export {
  clearSpotifyTokenCache,
  fetchSpotifyNowPlaying,
} from './spotify/client';
export { spotifyJsonResponse } from './spotify/response';
export {
  getSpotifyCredentials,
  getSpotifyCredentialsStatus,
  updateSpotifyCredentials,
  clearSpotifyCredentials,
  isConfiguredSecret,
  type SpotifyCredentials,
  type LanyardCredentials,
  type SpotifyCredentialsRecord,
  type CredentialSource,
  type CredentialFieldStatus,
  type SpotifyCredentialsStatus,
} from './spotify/credentials';
