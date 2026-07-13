import { hasRedisConfig, redisCommand } from '../community';
import { getServerEnv } from '../env';
import {
  firstConfiguredSecret,
  isConfiguredSecret,
  normalizeSecret,
} from '../secrets';
import type {
  CredentialFieldDefinition,
  CredentialFieldStatus,
  IntegrationCredentials,
  IntegrationDefinition,
  IntegrationId,
} from './types';

const CREDENTIALS_KEY_PREFIX = 'integrations:credentials:';
const SETTINGS_KEY = 'integrations:settings';
const ENABLED_KEY_PREFIX = 'integrations:enabled:';

const PATCH_CREDENTIALS_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local stored = { fields = {} }
if raw then
  local decodedOk, decoded = pcall(cjson.decode, raw)
  if not decodedOk or type(decoded) ~= 'table' or type(decoded.fields) ~= 'table' then
    return redis.error_reply('Stored integration credentials are malformed.')
  end
  for _, value in pairs(decoded.fields) do
    if type(value) ~= 'string' then
      return redis.error_reply('Stored integration credentials are malformed.')
    end
  end
  stored = decoded
end

local patch = cjson.decode(ARGV[1])
for key, value in pairs(patch) do
  if value == cjson.null then
    stored.fields[key] = nil
  else
    stored.fields[key] = value
  end
end

if next(stored.fields) == nil then
  redis.call('DEL', KEYS[1])
  return 1
end

stored.updatedAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(stored))
return 1
`;

/**
 * Keys written by the pre-registry implementation. Read once, on demand, when
 * the corresponding new key is absent, so an existing deployment keeps working
 * across the rollout without a manual migration step.
 */
const LEGACY_CREDENTIALS_KEY = 'admin:spotify-credentials';
const LEGACY_SETTINGS_KEY = 'admin:settings';

interface StoredCredentials {
  fields: Record<string, string>;
  updatedAt?: string;
}

interface StoredSettings {
  enabled: Partial<Record<IntegrationId, boolean>>;
}

function credentialsKey(id: IntegrationId): string {
  return `${CREDENTIALS_KEY_PREFIX}${id}`;
}

function enabledKey(id: IntegrationId): string {
  return `${ENABLED_KEY_PREFIX}${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseStoredCredentials(value: unknown): StoredCredentials | null {
  if (!isRecord(value) || !isRecord(value.fields)) return null;

  const fields = Object.fromEntries(
    Object.entries(value.fields).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const updatedAt =
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt))
      ? value.updatedAt
      : undefined;

  return { fields, updatedAt };
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

async function readJsonKey(
  key: string,
  tolerateFailure = true,
): Promise<unknown | null> {
  if (!hasRedisConfig()) return null;

  try {
    // `redisCommand` owns the request timeout. Do not race it with an
    // independent timer: returning while the fetch is still running leaves
    // request-bound I/O alive after the Worker request has completed.
    const raw = await redisCommand<string | null>(['GET', key]);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch (error) {
    // A corrupt or unreachable store is reported through the integration's
    // status, not by throwing into whatever request happened to touch it.
    if (!tolerateFailure) throw error;
    return null;
  }
}

/** Shape of the legacy credential blob, which fused Spotify and Lanyard. */
interface LegacyCredentials {
  spotify?: {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
  };
  lanyard?: { discordUserId?: string };
}

function legacyFieldsFor(
  id: IntegrationId,
  legacy: LegacyCredentials,
): Record<string, string> {
  const source =
    id === 'spotify'
      ? {
          clientId: legacy.spotify?.clientId,
          clientSecret: legacy.spotify?.clientSecret,
          refreshToken: legacy.spotify?.refreshToken,
        }
      : id === 'lanyard'
        ? { discordUserId: legacy.lanyard?.discordUserId }
        : {};

  return Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) => {
      const normalized = normalizeSecret(value);
      return normalized ? [[key, normalized]] : [];
    }),
  );
}

/**
 * Reads an integration's stored overrides, adopting the legacy blob the first
 * time it is asked for a key that does not exist yet. Adoption is idempotent:
 * the migrated value is written back under the new key, so the legacy read
 * happens at most once per integration per deployment.
 */
async function readStoredCredentials(
  id: IntegrationId,
  strict = false,
): Promise<StoredCredentials | null> {
  const stored = parseStoredCredentials(
    await readJsonKey(credentialsKey(id), !strict),
  );
  if (stored) return stored;

  const legacyValue = await readJsonKey(LEGACY_CREDENTIALS_KEY, !strict);
  if (!isRecord(legacyValue)) return null;
  const legacy = legacyValue as LegacyCredentials;

  const fields = legacyFieldsFor(id, legacy);
  if (Object.keys(fields).length === 0) return null;

  const migrated: StoredCredentials = {
    fields,
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeStoredCredentials(id, migrated);
  } catch (error) {
    // The value is still usable for this request even if the write-back fails;
    // the next read will simply migrate again.
    if (strict) throw error;
  }

  return migrated;
}

async function writeStoredCredentials(
  id: IntegrationId,
  value: StoredCredentials,
): Promise<void> {
  await redisCommand(['SET', credentialsKey(id), JSON.stringify(value)]);
}

function envValueFor(field: CredentialFieldDefinition): string | undefined {
  return firstConfiguredSecret(
    ...field.envVars.map((name) => getServerEnv(name)),
  );
}

/**
 * Resolves each field to a usable value, preferring an operator-set override
 * over the deployment env. Placeholder values are filtered at both layers.
 */
export async function resolveCredentials(
  definition: IntegrationDefinition,
): Promise<IntegrationCredentials> {
  const stored = await readStoredCredentials(definition.id);

  return Object.fromEntries(
    definition.credentials.map((field) => [
      field.key,
      firstConfiguredSecret(stored?.fields[field.key], envValueFor(field)),
    ]),
  );
}

/**
 * Per-field provenance for the admin UI. Deliberately returns no secret
 * material — only whether a value exists and where it came from.
 */
export async function getCredentialStatuses(
  definition: IntegrationDefinition,
): Promise<CredentialFieldStatus[]> {
  const stored = await readStoredCredentials(definition.id);

  return definition.credentials.map((field) => {
    const override = stored?.fields[field.key];
    if (isConfiguredSecret(override)) {
      return {
        key: field.key,
        set: true,
        source: 'override',
        updatedAt: stored?.updatedAt,
      };
    }

    if (isConfiguredSecret(envValueFor(field))) {
      return { key: field.key, set: true, source: 'env' };
    }

    return { key: field.key, set: false, source: 'none' };
  });
}

/** True when every required field for this integration resolves to a value. */
export async function isConfigured(
  definition: IntegrationDefinition,
): Promise<boolean> {
  if (definition.credentials.length === 0) return true;

  const credentials = await resolveCredentials(definition);
  return definition.credentials
    .filter((field) => field.required)
    .every((field) => isConfiguredSecret(credentials[field.key]));
}

export class CredentialValidationError extends Error {
  readonly issues: Array<{ key: string; message: string }>;

  constructor(issues: Array<{ key: string; message: string }>) {
    super('One or more credentials are invalid.');
    this.name = 'CredentialValidationError';
    this.issues = issues;
  }
}

/**
 * Applies a partial credential update. Fields absent from the patch keep their
 * current value; fields present but blank are cleared, which is how the UI
 * removes a single override without revoking the whole integration.
 */
export async function updateCredentials(
  definition: IntegrationDefinition,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }

  const known = new Map(
    definition.credentials.map((field) => [field.key, field]),
  );
  const issues: Array<{ key: string; message: string }> = [];
  const updates = new Map<string, string | null>();

  for (const [key, raw] of Object.entries(patch)) {
    const field = known.get(key);
    if (!field) {
      issues.push({ key, message: `Unknown field for ${definition.name}.` });
      continue;
    }

    const value = normalizeSecret(raw);
    if (value === undefined) {
      updates.set(key, null);
      continue;
    }

    const problem = field.validate?.(value);
    if (problem) {
      issues.push({ key, message: problem });
      continue;
    }

    updates.set(key, value);
  }

  if (issues.length > 0) throw new CredentialValidationError(issues);
  if (updates.size === 0) {
    throw new CredentialValidationError([
      { key: '_', message: 'No credential fields were provided.' },
    ]);
  }

  // Complete any one-time legacy migration before applying the patch. Strict
  // reads prevent a transient GET failure from being mistaken for an empty
  // credential set and overwriting fields the operator did not edit.
  await readStoredCredentials(definition.id, true);

  // Merge inside Redis so concurrent partial updates cannot clobber one
  // another. JSON null represents an explicit field deletion.
  await redisCommand([
    'EVAL',
    PATCH_CREDENTIALS_SCRIPT,
    1,
    credentialsKey(definition.id),
    JSON.stringify(Object.fromEntries(updates)),
    new Date().toISOString(),
  ]);
}

/**
 * Revokes every stored override. Env-provided values remain in effect, which
 * the status response reports honestly rather than claiming the integration is
 * now unconfigured.
 */
export async function clearCredentials(id: IntegrationId): Promise<void> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }
  await redisCommand(['DEL', credentialsKey(id)]);
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
