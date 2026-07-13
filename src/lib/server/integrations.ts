// Public surface of the integrations domain. Routes and now-playing import
// from here; implementation modules remain private to the domain.
export {
  fetchLanyardNowPlaying,
  lanyardIntegration,
} from './integrations/providers/lanyard';
export {
  fetchSpotifyNowPlaying,
  spotifyIntegration,
} from './integrations/providers/spotify';
export {
  isIntegrationUsable,
  recordIntegrationOutcome,
} from './integrations/status';
export {
  IntegrationNotManageableError,
  UnknownIntegrationError,
  listIntegrations,
  revokeIntegrationCredentials,
  saveIntegrationCredentials,
  testIntegration,
  toggleIntegration,
} from './integrations/service';
export {
  CredentialValidationError,
  resolveCredentials,
} from './integrations/store';
export type { IntegrationDefinition } from './integrations/types';
