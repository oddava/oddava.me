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

async function readJsonKey(key: string): Promise<unknown | null> {
  if (!hasRedisConfig()) return null;

  try {
    // `redisCommand` owns the request timeout. Do not race it with an
    // independent timer: returning while the fetch is still running leaves
    // request-bound I/O alive after the Worker request has completed.
    const raw = await redisCommand<string | null>(['GET', key]);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    // A corrupt or unreachable store must not throw into whatever request
    // happened to touch it; the integration falls back to its default state.
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

async function readSettings(): Promise<StoredSettings> {
  const stored = parseStoredSettings(await readJsonKey(SETTINGS_KEY));
  if (stored) return stored;

  const legacyValue = await readJsonKey(LEGACY_SETTINGS_KEY);
  const legacy = isRecord(legacyValue)
    ? (legacyValue as {
        integrations?: Partial<Record<string, boolean>>;
      })
    : null;

  if (typeof legacy?.integrations?.spotify === 'boolean') {
    return { enabled: { spotify: legacy.integrations.spotify } };
  }

  return { enabled: {} };
}

async function readEnabledOverrides(
  definitions: readonly IntegrationDefinition[],
): Promise<Partial<Record<IntegrationId, boolean>>> {
  if (!hasRedisConfig() || definitions.length === 0) return {};

  try {
    const values = await redisCommand<Array<string | null>>([
      'MGET',
      ...definitions.map((definition) => enabledKey(definition.id)),
    ]);
    if (!Array.isArray(values)) return {};

    return Object.fromEntries(
      definitions.flatMap((definition, index) => {
        const value = values[index];
        return value === '1' || value === '0'
          ? [[definition.id, value === '1']]
          : [];
      }),
    );
  } catch {
    return {};
  }
}

/** Resolved on/off state for every integration, falling back to its default. */
export async function getEnabledMap(
  definitions: readonly IntegrationDefinition[],
): Promise<Record<IntegrationId, boolean>> {
  const [overrides, legacySettings] = await Promise.all([
    readEnabledOverrides(definitions),
    readSettings(),
  ]);

  return Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      // A non-manageable integration cannot be switched off, so a stale stored
      // value must not be able to disable it.
      definition.manageable
        ? (overrides[definition.id] ??
          legacySettings.enabled[definition.id] ??
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
