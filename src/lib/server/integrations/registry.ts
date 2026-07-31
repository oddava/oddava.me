import { lanyardIntegration } from './providers/lanyard';
import { spotifyIntegration } from './providers/spotify';
import type { IntegrationDefinition } from './types';

/**
 * The single place a new integration is registered. Everything downstream — the
 * credential store, the admin API, the status list and the admin UI — is driven
 * off this array, so adding a provider means writing one definition file and
 * appending it here.
 */
export const INTEGRATIONS: readonly IntegrationDefinition[] = [
  spotifyIntegration,
  lanyardIntegration,
];

const BY_ID = new Map<string, IntegrationDefinition>(
  INTEGRATIONS.map((definition) => [definition.id, definition]),
);

export function getIntegration(id: string): IntegrationDefinition | undefined {
  return BY_ID.get(id);
}
