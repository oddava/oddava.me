import { getIntegration } from './registry';
import {
  getIntegrationStatus,
  getIntegrationStatuses,
  invalidateIntegrationStatus,
} from './status';
import { clearCredentials, setEnabled, updateCredentials } from './store';
import type { IntegrationDefinition, IntegrationStatus } from './types';

export class UnknownIntegrationError extends Error {
  constructor(id: string) {
    super(`Unknown integration: ${id}.`);
    this.name = 'UnknownIntegrationError';
  }
}

function requireIntegration(id: string): IntegrationDefinition {
  const definition = getIntegration(id);
  if (!definition) throw new UnknownIntegrationError(id);
  return definition;
}

export class IntegrationNotManageableError extends Error {
  constructor(name: string) {
    super(`${name} cannot be enabled or disabled from the admin panel.`);
    this.name = 'IntegrationNotManageableError';
  }
}

export function listIntegrations(): Promise<IntegrationStatus[]> {
  return getIntegrationStatuses();
}

/**
 * Turns an integration on or off. Disabling takes effect immediately on the
 * request path — the now-playing service checks the flag before every call —
 * so this is a real kill switch, not just a UI label.
 */
export async function toggleIntegration(
  id: string,
  enabled: boolean,
): Promise<IntegrationStatus> {
  const definition = requireIntegration(id);

  if (!definition.manageable) {
    throw new IntegrationNotManageableError(definition.name);
  }

  await setEnabled(definition.id, enabled);

  // Re-enabling must not resurrect a stale check result from before the outage
  // that caused the operator to switch it off.
  invalidateIntegrationStatus(definition.id);

  return getIntegrationStatus(definition, { force: enabled });
}

/** Runs a live connection test, bypassing both the status cache and the breaker. */
export async function testIntegration(id: string): Promise<IntegrationStatus> {
  const definition = requireIntegration(id);
  return getIntegrationStatus(definition, { force: true });
}

/**
 * Saves a partial credential update, then immediately re-tests so the operator
 * finds out whether the value they just pasted actually works.
 */
export async function saveIntegrationCredentials(
  id: string,
  patch: Record<string, unknown>,
): Promise<IntegrationStatus> {
  const definition = requireIntegration(id);

  await updateCredentials(definition, patch);
  definition.onCredentialsChanged?.();
  invalidateIntegrationStatus(definition.id);

  return getIntegrationStatus(definition, { force: true });
}

/**
 * Revokes every stored credential override. Values supplied through the
 * deployment environment survive — the returned status says so rather than
 * pretending the integration is now unconfigured.
 */
export async function revokeIntegrationCredentials(
  id: string,
): Promise<IntegrationStatus> {
  const definition = requireIntegration(id);

  await clearCredentials(definition.id);
  definition.onCredentialsChanged?.();
  invalidateIntegrationStatus(definition.id);

  return getIntegrationStatus(definition, { force: true });
}
