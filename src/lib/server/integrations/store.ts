import { hasRedisConfig, redisCommand } from '../core';
import { getServerEnv } from '../env';
import { firstConfiguredSecret, isConfiguredSecret } from '../secrets';
import type {
  CredentialFieldDefinition,
  CredentialFieldStatus,
  IntegrationCredentials,
  IntegrationDefinition,
  IntegrationId,
} from './types';

const SETTINGS_KEY = 'integrations:settings';
const ENABLED_KEY_PREFIX = 'integrations:enabled:';

/**
 * Keys written by the pre-registry implementation. Read on demand when the
 * corresponding new key is absent, so an existing deployment keeps working
 * without a manual migration step.
 */
const LEGACY_SETTINGS_KEY = 'admin:settings';

interface StoredSettings {
  enabled: Partial<Record<IntegrationId, boolean>>;
}

function enabledKey(id: IntegrationId): string {
  return `${ENABLED_KEY_PREFIX}${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseStoredSettings(value: unknown): StoredSettings | null {
  if (!isRecord(value) || !isRecord(value.enabled)) return null;

  const enabled = Object.fromEntries(
    Object.entries(value.enabled).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  ) as Partial<Record<IntegrationId, boolean>>;
  return { enabled };
}

function parseJson(raw: string | null | undefined): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // A corrupt value must not throw into whatever request happened to touch
    // it; the integration falls back to its default state.
    return null;
  }
}

function envValueFor(field: CredentialFieldDefinition): string | undefined {
  return firstConfiguredSecret(
    ...field.envVars.map((name) => getServerEnv(name)),
  );
}

/**
 * Resolves each credential field from the deployment environment. Placeholder
 * values are filtered, so a copied example file does not read as configured.
 *
 * Synchronous by design: credentials are deployment state, not runtime state,
 * and nothing on the request path should pay a network round trip to learn
 * what its own env already says.
 */
export function resolveCredentials(
  definition: IntegrationDefinition,
): IntegrationCredentials {
  return Object.fromEntries(
    definition.credentials.map((field) => [field.key, envValueFor(field)]),
  );
}

/**
 * Per-field provenance for the admin UI. Deliberately returns no secret
 * material — only whether a value exists and where it came from.
 */
export function getCredentialStatuses(
  definition: IntegrationDefinition,
): CredentialFieldStatus[] {
  return definition.credentials.map((field) =>
    isConfiguredSecret(envValueFor(field))
      ? { key: field.key, set: true, source: 'env' }
      : { key: field.key, set: false, source: 'none' },
  );
}

/** True when every required field for this integration resolves to a value. */
export function isConfigured(definition: IntegrationDefinition): boolean {
  if (definition.credentials.length === 0) return true;

  const credentials = resolveCredentials(definition);
  return definition.credentials
    .filter((field) => field.required)
    .every((field) => isConfiguredSecret(credentials[field.key]));
}

function legacySettingsFrom(value: unknown): StoredSettings {
  const legacy = isRecord(value)
    ? (value as { integrations?: Partial<Record<string, boolean>> })
    : null;

  return typeof legacy?.integrations?.spotify === 'boolean'
    ? { enabled: { spotify: legacy.integrations.spotify } }
    : { enabled: {} };
}

interface EnabledState {
  overrides: Partial<Record<IntegrationId, boolean>>;
  settings: StoredSettings;
}

const EMPTY_STATE: EnabledState = { overrides: {}, settings: { enabled: {} } };

/**
 * Reads every key the enabled state can come from in one round trip: the
 * per-provider flags, the settings blob, and the pre-registry settings blob
 * they superseded.
 *
 * This is the only storage read on the public request path, so it is one read.
 * Fetching the fallbacks unconditionally trades a few bytes of response for the
 * two extra round trips that reading them on-miss would cost — and on-miss is
 * the common case, because a provider that was never toggled has no key.
 */
async function readEnabledState(
  definitions: readonly IntegrationDefinition[],
): Promise<EnabledState> {
  if (!hasRedisConfig() || definitions.length === 0) return EMPTY_STATE;

  try {
    // `redisCommand` owns the request timeout. Do not race it with an
    // independent timer: returning while the fetch is still running leaves
    // request-bound I/O alive after the Worker request has completed.
    const values = await redisCommand<Array<string | null>>([
      'MGET',
      ...definitions.map((definition) => enabledKey(definition.id)),
      SETTINGS_KEY,
      LEGACY_SETTINGS_KEY,
    ]);
    if (!Array.isArray(values)) return EMPTY_STATE;

    const overrides = Object.fromEntries(
      definitions.flatMap((definition, index) => {
        const value = values[index];
        return value === '1' || value === '0'
          ? [[definition.id, value === '1']]
          : [];
      }),
    );

    const settings =
      parseStoredSettings(parseJson(values[definitions.length])) ??
      legacySettingsFrom(parseJson(values[definitions.length + 1]));

    return { overrides, settings };
  } catch {
    // An unreachable store leaves every provider at its declared default rather
    // than failing the request that happened to touch it.
    return EMPTY_STATE;
  }
}

/** Resolved on/off state for every integration, falling back to its default. */
export async function getEnabledMap(
  definitions: readonly IntegrationDefinition[],
): Promise<Record<IntegrationId, boolean>> {
  const { overrides, settings } = await readEnabledState(definitions);

  return Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      // A non-manageable integration cannot be switched off, so a stale stored
      // value must not be able to disable it.
      definition.manageable
        ? (overrides[definition.id] ??
          settings.enabled[definition.id] ??
          definition.enabledByDefault)
        : true,
    ]),
  ) as Record<IntegrationId, boolean>;
}

export async function setEnabled(
  id: IntegrationId,
  enabled: boolean,
): Promise<void> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }

  // One key per provider makes independent toggles atomic and prevents two
  // concurrent admin requests from overwriting each other's settings blob.
  await redisCommand(['SET', enabledKey(id), enabled ? '1' : '0']);
}
