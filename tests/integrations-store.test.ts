import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationDefinition } from '../src/lib/server/integrations/types';

/**
 * A stand-in provider, so the store is tested through the same public contract
 * a real integration uses rather than through Spotify's specifics.
 */
const definition: IntegrationDefinition = {
  id: 'spotify',
  name: 'Test',
  description: 'test',
  manageable: true,
  enabledByDefault: true,
  credentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      kind: 'text',
      required: true,
      envVars: ['SPOTIFY_CLIENT_ID'],
    },
    {
      key: 'clientSecret',
      label: 'Client secret',
      kind: 'secret',
      required: true,
      envVars: ['SPOTIFY_CLIENT_SECRET'],
      validate: (value) =>
        value.length >= 4 ? null : 'Must be at least 4 characters.',
    },
    {
      key: 'note',
      label: 'Note',
      kind: 'text',
      required: false,
      envVars: [],
    },
  ],
  check: async () => ({ state: 'ok', detail: 'ok' }),
};

/** In-memory Redis double, so tests exercise real read/write paths. */
function mockRedis(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));

  const redisCommand = vi.fn(async (command: (string | number)[]) => {
    const [op, key, value] = command.map(String);
    if (op === 'GET') return data.get(key) ?? null;
    if (op === 'MGET') {
      return command.slice(1).map((item) => data.get(String(item)) ?? null);
    }
    if (op === 'SET') {
      data.set(key, value);
      return 'OK';
    }
    if (op === 'EVAL') {
      const target = String(command[3]);
      const patch = JSON.parse(String(command[4])) as Record<
        string,
        string | null
      >;
      const stored = data.has(target)
        ? (JSON.parse(data.get(target)!) as {
            fields: Record<string, string>;
            updatedAt?: string;
          })
        : { fields: {} };
      for (const [field, next] of Object.entries(patch)) {
        if (next === null) delete stored.fields[field];
        else stored.fields[field] = next;
      }
      if (Object.keys(stored.fields).length === 0) {
        data.delete(target);
      } else {
        stored.updatedAt = String(command[5]);
        data.set(target, JSON.stringify(stored));
      }
      return 1;
    }
    if (op === 'DEL') {
      data.delete(key);
      return 1;
    }
    throw new Error(`Unexpected command: ${op}`);
  });

  vi.doMock('../src/lib/server/core', () => ({
    hasRedisConfig: () => true,
    redisCommand,
  }));

  return { data, redisCommand };
}

function mockNoRedis() {
  vi.doMock('../src/lib/server/core', () => ({
    hasRedisConfig: () => false,
    redisCommand: vi.fn(async () => {
      throw new Error('Persistent storage is not configured.');
    }),
  }));
}

const importStore = () => import('../src/lib/server/integrations/store');

describe('integration credential store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock('../src/lib/server/core');
  });

  it('falls back to the environment when nothing is stored', async () => {
    mockNoRedis();
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'env-client-id');

    const { resolveCredentials, getCredentialStatuses } = await importStore();

    expect((await resolveCredentials(definition)).clientId).toBe(
      'env-client-id',
    );

    const statuses = await getCredentialStatuses(definition);
    expect(statuses).toContainEqual({
      key: 'clientId',
      set: true,
      source: 'env',
    });
    expect(statuses).toContainEqual({
      key: 'clientSecret',
      set: false,
      source: 'none',
    });
  });

  it('treats .env.example placeholders as unset', async () => {
    mockNoRedis();
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'your_spotify_client_id');
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'put_it_here');

    const { getCredentialStatuses, isConfigured } = await importStore();

    expect(await getCredentialStatuses(definition)).toEqual([
      { key: 'clientId', set: false, source: 'none' },
      { key: 'clientSecret', set: false, source: 'none' },
      { key: 'note', set: false, source: 'none' },
    ]);
    expect(await isConfigured(definition)).toBe(false);
  });

  it('prefers a stored override over the environment', async () => {
    mockRedis({
      'integrations:credentials:spotify': JSON.stringify({
        fields: { clientId: 'stored-id' },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'env-id');

    const { resolveCredentials, getCredentialStatuses } = await importStore();

    expect((await resolveCredentials(definition)).clientId).toBe('stored-id');
    expect(await getCredentialStatuses(definition)).toContainEqual({
      key: 'clientId',
      set: true,
      source: 'override',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('ignores malformed stored fields without losing valid values', async () => {
    mockRedis({
      'integrations:credentials:spotify': JSON.stringify({
        fields: { clientId: 42, clientSecret: 'stored-secret' },
        updatedAt: 'not-a-date',
      }),
    });
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'env-id');

    const { resolveCredentials, getCredentialStatuses } = await importStore();

    expect(await resolveCredentials(definition)).toMatchObject({
      clientId: 'env-id',
      clientSecret: 'stored-secret',
    });
    expect(await getCredentialStatuses(definition)).toContainEqual({
      key: 'clientSecret',
      set: true,
      source: 'override',
    });
  });

  it('ignores optional fields when deciding whether it is configured', async () => {
    mockNoRedis();
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'id');
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'secret');

    const { isConfigured } = await importStore();

    // `note` is unset, but it is not required.
    expect(await isConfigured(definition)).toBe(true);
  });

  it('adopts credentials written by the pre-registry implementation', async () => {
    const { data } = mockRedis({
      'admin:spotify-credentials': JSON.stringify({
        spotify: { clientId: 'legacy-id', clientSecret: 'legacy-secret' },
        lanyard: { discordUserId: '123456789012345678' },
      }),
    });

    const { resolveCredentials } = await importStore();

    expect(await resolveCredentials(definition)).toMatchObject({
      clientId: 'legacy-id',
      clientSecret: 'legacy-secret',
    });

    // The migration is written back, so the legacy key is read at most once.
    const migrated = JSON.parse(
      data.get('integrations:credentials:spotify') as string,
    );
    expect(migrated.fields).toEqual({
      clientId: 'legacy-id',
      clientSecret: 'legacy-secret',
    });
  });

  it('rejects a value its field says is invalid, without writing anything', async () => {
    const { data } = mockRedis();
    const { updateCredentials, CredentialValidationError } =
      await importStore();

    await expect(
      updateCredentials(definition, { clientSecret: 'no' }),
    ).rejects.toBeInstanceOf(CredentialValidationError);

    expect(data.size).toBe(0);
  });

  it('rejects fields the integration does not declare', async () => {
    mockRedis();
    const { updateCredentials, CredentialValidationError } =
      await importStore();

    await expect(
      updateCredentials(definition, { nope: 'value' }),
    ).rejects.toBeInstanceOf(CredentialValidationError);
  });

  it('merges a partial update and clears a field sent blank', async () => {
    const { data } = mockRedis({
      'integrations:credentials:spotify': JSON.stringify({
        fields: { clientId: 'old-id', clientSecret: 'kept-secret' },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    });

    const { updateCredentials } = await importStore();

    await updateCredentials(definition, { clientId: 'new-id' });
    expect(
      JSON.parse(data.get('integrations:credentials:spotify') as string).fields,
    ).toEqual({ clientId: 'new-id', clientSecret: 'kept-secret' });

    await updateCredentials(definition, { clientId: '   ' });
    expect(
      JSON.parse(data.get('integrations:credentials:spotify') as string).fields,
    ).toEqual({ clientSecret: 'kept-secret' });
  });

  it('merges concurrent partial credential updates atomically', async () => {
    const { data } = mockRedis({
      'integrations:credentials:spotify': JSON.stringify({
        fields: { clientSecret: 'kept-secret' },
      }),
    });
    const { updateCredentials } = await importStore();

    await Promise.all([
      updateCredentials(definition, { clientId: 'new-id' }),
      updateCredentials(definition, { note: 'operator note' }),
    ]);

    expect(
      JSON.parse(data.get('integrations:credentials:spotify') as string).fields,
    ).toEqual({
      clientId: 'new-id',
      clientSecret: 'kept-secret',
      note: 'operator note',
    });
  });

  it('does not overwrite stored credentials after a failed strict read', async () => {
    const original = JSON.stringify({
      fields: { clientId: 'old-id', clientSecret: 'kept-secret' },
    });
    const { data, redisCommand } = mockRedis({
      'integrations:credentials:spotify': original,
    });
    redisCommand.mockRejectedValueOnce(new Error('Redis unavailable'));
    const { updateCredentials } = await importStore();

    await expect(
      updateCredentials(definition, { clientId: 'new-id' }),
    ).rejects.toThrow('Redis unavailable');
    expect(data.get('integrations:credentials:spotify')).toBe(original);
  });

  it('refuses to save credentials when storage is unavailable', async () => {
    mockNoRedis();
    const { clearCredentials, updateCredentials } = await importStore();

    await expect(
      updateCredentials(definition, { clientId: 'id' }),
    ).rejects.toThrow('Persistent storage is not configured.');
    await expect(clearCredentials('spotify')).rejects.toThrow(
      'Persistent storage is not configured.',
    );
  });

  it('revokes stored overrides while leaving env values in effect', async () => {
    const { data } = mockRedis({
      'integrations:credentials:spotify': JSON.stringify({
        fields: { clientId: 'stored-id' },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'env-id');

    const { clearCredentials, resolveCredentials } = await importStore();

    await clearCredentials('spotify');

    expect(data.has('integrations:credentials:spotify')).toBe(false);
    expect((await resolveCredentials(definition)).clientId).toBe('env-id');
  });
});

describe('integration enablement', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/lib/server/core');
  });

  const manageable = definition;
  const alwaysOn: IntegrationDefinition = {
    ...definition,
    id: 'turnstile',
    manageable: false,
  };

  it('defaults to each integration’s own default', async () => {
    mockRedis();
    const { getEnabledMap } = await importStore();

    expect(await getEnabledMap([manageable, alwaysOn])).toEqual({
      spotify: true,
      turnstile: true,
    });
  });

  it('ignores malformed enablement values', async () => {
    mockRedis({
      'integrations:settings': JSON.stringify({
        enabled: { spotify: 'no', turnstile: true },
      }),
    });
    const { getEnabledMap } = await importStore();

    expect(await getEnabledMap([manageable, alwaysOn])).toEqual({
      spotify: true,
      turnstile: true,
    });
  });

  it('round-trips a toggle', async () => {
    mockRedis();
    const { getEnabledMap, setEnabled } = await importStore();

    await setEnabled('spotify', false);

    expect(await getEnabledMap([manageable])).toEqual({ spotify: false });
  });

  it('keeps concurrent provider toggles independent', async () => {
    mockRedis();
    const lanyard: IntegrationDefinition = {
      ...definition,
      id: 'lanyard',
    };
    const { getEnabledMap, setEnabled } = await importStore();

    await Promise.all([
      setEnabled('spotify', false),
      setEnabled('lanyard', false),
    ]);

    expect(await getEnabledMap([manageable, lanyard])).toEqual({
      spotify: false,
      lanyard: false,
    });
  });

  it('cannot disable a non-manageable integration, even from stored state', async () => {
    // A stale or tampered settings blob must not be able to switch off a
    // security control that the UI never exposes a switch for.
    mockRedis({
      'integrations:settings': JSON.stringify({
        enabled: { turnstile: false },
      }),
    });

    const { getEnabledMap } = await importStore();

    expect((await getEnabledMap([alwaysOn])).turnstile).toBe(true);
  });

  it('adopts the legacy settings key', async () => {
    mockRedis({
      'admin:settings': JSON.stringify({ integrations: { spotify: false } }),
    });

    const { getEnabledMap } = await importStore();

    expect((await getEnabledMap([manageable])).spotify).toBe(false);
  });
});
