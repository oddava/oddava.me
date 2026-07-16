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

describe('integration credential resolution', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock('../src/lib/server/core');
  });

  it('resolves a credential from the environment', async () => {
    mockNoRedis();
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'env-client-id');

    const { resolveCredentials, getCredentialStatuses } = await importStore();

    expect(resolveCredentials(definition).clientId).toBe('env-client-id');
    expect(getCredentialStatuses(definition)).toContainEqual({
      key: 'clientId',
      set: true,
      source: 'env',
    });
  });

  it('treats an example-file placeholder as unconfigured', async () => {
    mockNoRedis();
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'your_client_id_here');

    const { getCredentialStatuses, isConfigured } = await importStore();

    expect(getCredentialStatuses(definition)).toContainEqual({
      key: 'clientId',
      set: false,
      source: 'none',
    });
    expect(isConfigured(definition)).toBe(false);
  });

  it('reads the first env var that is actually set, in declared order', async () => {
    mockNoRedis();
    const multi: IntegrationDefinition = {
      ...definition,
      credentials: [
        {
          key: 'discordUserId',
          label: 'Discord user ID',
          kind: 'text',
          required: true,
          envVars: ['DISCORD_USER_ID', 'LANYARD_DISCORD_USER_ID'],
        },
      ],
    };
    vi.stubEnv('LANYARD_DISCORD_USER_ID', 'fallback-id');

    const { resolveCredentials } = await importStore();

    expect(resolveCredentials(multi).discordUserId).toBe('fallback-id');
  });

  it('is configured only when every required field resolves', async () => {
    mockNoRedis();
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'env-client-id');

    const { isConfigured } = await importStore();

    // `note` is optional, so its absence must not make the whole thing unconfigured.
    expect(isConfigured(definition)).toBe(false);

    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'env-client-secret');
    expect(isConfigured(definition)).toBe(true);
  });

  it('reports a provider with no credentials as configured', async () => {
    mockNoRedis();
    const { isConfigured } = await importStore();

    expect(isConfigured({ ...definition, credentials: [] })).toBe(true);
  });

  /**
   * The point of the change: credentials are deployment state, so reading them
   * must not touch the network. A regression here reintroduces a per-request
   * round trip on the public now-playing path.
   */
  it('never touches Redis to resolve credentials', async () => {
    const { redisCommand } = mockRedis({
      'integrations:credentials:spotify': JSON.stringify({
        fields: { clientId: 'stored-id' },
      }),
    });
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'env-client-id');

    const { resolveCredentials, getCredentialStatuses, isConfigured } =
      await importStore();

    // A leftover override key from the old store is simply not consulted.
    expect(resolveCredentials(definition).clientId).toBe('env-client-id');
    getCredentialStatuses(definition);
    isConfigured(definition);

    expect(redisCommand).not.toHaveBeenCalled();
  });

  it('never reports a source other than env or none', async () => {
    mockNoRedis();
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'env-client-id');

    const { getCredentialStatuses } = await importStore();

    for (const status of getCredentialStatuses(definition)) {
      expect(['env', 'none']).toContain(status.source);
    }
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
