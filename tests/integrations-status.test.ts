import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationError } from '../src/lib/server/integrations/errors';
import type {
  IntegrationCheckResult,
  IntegrationDefinition,
} from '../src/lib/server/integrations/types';

interface Harness {
  check: ReturnType<typeof vi.fn>;
  definition: IntegrationDefinition;
}

function makeDefinition(
  overrides: Partial<IntegrationDefinition> = {},
): Harness {
  const check = vi.fn(async (): Promise<IntegrationCheckResult> => ({
    state: 'ok',
    detail: 'Connected.',
  }));

  const definition: IntegrationDefinition = {
    id: 'spotify',
    name: 'Spotify',
    description: 'test',
    manageable: true,
    enabledByDefault: true,
    credentials: [
      {
        key: 'clientId',
        label: 'Client ID',
        kind: 'text',
        required: true,
        envVars: [],
      },
    ],
    check,
    ...overrides,
  };

  return { check, definition };
}

/**
 * Mocks the registry and the store so the status service is tested in
 * isolation: real providers and real Redis are somebody else's tests.
 */
async function loadStatus(
  definition: IntegrationDefinition,
  options: { enabled?: boolean; configured?: boolean } = {},
) {
  const { enabled = true, configured = true } = options;

  vi.doMock('../src/lib/server/integrations/registry', () => ({
    INTEGRATIONS: [definition],
    getIntegration: (id: string) =>
      id === definition.id ? definition : undefined,
    isIntegrationId: (id: string) => id === definition.id,
  }));

  vi.doMock('../src/lib/server/integrations/store', () => ({
    resolveCredentials: () => ({ clientId: 'value' }),
    getCredentialStatuses: () =>
      definition.credentials.map((field) => ({
        key: field.key,
        set: configured,
        source: configured ? 'env' : 'none',
      })),
    isConfigured: () => configured,
    getEnabledMap: async () => ({ [definition.id]: enabled }),
  }));

  return import('../src/lib/server/integrations/status');
}

describe('integration status', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/lib/server/integrations/registry');
    vi.doUnmock('../src/lib/server/integrations/store');
  });

  it('reports a healthy integration', async () => {
    const { definition } = makeDefinition();
    const { getIntegrationStatuses } = await loadStatus(definition);

    const [status] = await getIntegrationStatuses();

    expect(status).toMatchObject({
      id: 'spotify',
      state: 'ok',
      enabled: true,
      configured: true,
      detail: 'Connected.',
    });
    expect(status.checkedAt).toBeDefined();
  });

  it('never contacts a disabled integration', async () => {
    const { check, definition } = makeDefinition();
    const { getIntegrationStatuses } = await loadStatus(definition, {
      enabled: false,
    });

    const [status] = await getIntegrationStatuses();

    expect(check).not.toHaveBeenCalled();
    expect(status.state).toBe('disabled');
    expect(status.detail).toContain('No requests are made to it');
  });

  it('never contacts an unconfigured integration, and names what is missing', async () => {
    const { check, definition } = makeDefinition();
    const { getIntegrationStatuses } = await loadStatus(definition, {
      configured: false,
    });

    const [status] = await getIntegrationStatuses();

    expect(check).not.toHaveBeenCalled();
    expect(status.state).toBe('unconfigured');
    expect(status.detail).toContain('Client ID');
  });

  it('never exposes secret material to the client', async () => {
    const { definition } = makeDefinition();
    const { getIntegrationStatuses } = await loadStatus(definition);

    const [status] = await getIntegrationStatuses();

    expect(JSON.stringify(status)).not.toContain('value');
    expect(status.credentials).toEqual([
      { key: 'clientId', set: true, source: 'env' },
    ]);
  });

  it('reuses a recent check instead of re-probing the upstream', async () => {
    const { check, definition } = makeDefinition();
    const { getIntegrationStatuses } = await loadStatus(definition);

    await getIntegrationStatuses();
    await getIntegrationStatuses();

    expect(check).toHaveBeenCalledTimes(1);
  });

  it('re-probes when the caller forces a test', async () => {
    const { check, definition } = makeDefinition();
    const { getIntegrationStatus, getIntegrationStatuses } =
      await loadStatus(definition);

    await getIntegrationStatuses();
    await getIntegrationStatus(definition, { force: true });

    expect(check).toHaveBeenCalledTimes(2);
  });

  it('surfaces a rate limit as degraded, not as a failure', async () => {
    const { check, definition } = makeDefinition();
    check.mockRejectedValue(
      new IntegrationError({
        code: 'rate_limited',
        message: 'Rate limited; retry in 30s.',
        retryAfterSeconds: 30,
      }),
    );

    const { getIntegrationStatuses } = await loadStatus(definition);
    const [status] = await getIntegrationStatuses();

    expect(status.state).toBe('degraded');
    expect(status.code).toBe('rate_limited');
  });

  it('reports a failing check as an error', async () => {
    const { check, definition } = makeDefinition();
    check.mockRejectedValue(
      new IntegrationError({
        code: 'upstream_unavailable',
        message: 'Spotify is down.',
      }),
    );

    const { getIntegrationStatuses } = await loadStatus(definition);
    const [status] = await getIntegrationStatuses();

    expect(status).toMatchObject({
      state: 'error',
      code: 'upstream_unavailable',
      detail: 'Spotify is down.',
    });
  });

  it('contains a provider that throws a non-integration error', async () => {
    const { check, definition } = makeDefinition();
    check.mockRejectedValue(new Error('kaboom'));

    const { getIntegrationStatuses } = await loadStatus(definition);
    const [status] = await getIntegrationStatuses();

    expect(status.state).toBe('error');
    expect(status.detail).toBe('kaboom');
  });

  /**
   * What used to be the circuit breaker's job. The check cache — not a failure
   * counter — is what bounds probing, and it does so whether the provider is
   * healthy or not.
   */
  it('still bounds probing of a failing provider without a breaker', async () => {
    const { check, definition } = makeDefinition();
    check.mockRejectedValue(
      new IntegrationError({
        code: 'upstream_unavailable',
        message: 'Spotify is down.',
      }),
    );

    const { getIntegrationStatus } = await loadStatus(definition);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await getIntegrationStatus(definition);
    }

    // One live probe; the other four were served from the 30s check cache.
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('recovers as soon as the provider does, with no cooldown to wait out', async () => {
    const { check, definition } = makeDefinition();
    check.mockRejectedValue(
      new IntegrationError({
        code: 'upstream_unavailable',
        message: 'Spotify is down.',
      }),
    );

    const { getIntegrationStatus } = await loadStatus(definition);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await getIntegrationStatus(definition, { force: true });
    }

    // Under the old breaker this many failures opened a five-minute cooldown
    // that a forced check had to punch through. Now it is simply the next read.
    check.mockResolvedValue({ state: 'ok', detail: 'Connected.' });
    const status = await getIntegrationStatus(definition, { force: true });

    expect(status.state).toBe('ok');
  });

  describe('isIntegrationUsable', () => {
    it('reports an enabled, configured integration as usable', async () => {
      const { definition } = makeDefinition();
      const { isIntegrationUsable } = await loadStatus(definition);

      expect(await isIntegrationUsable(definition)).toBe(true);
    });

    it('reports a disabled integration as unusable — the kill switch', async () => {
      const { definition } = makeDefinition();
      const { isIntegrationUsable } = await loadStatus(definition, {
        enabled: false,
      });

      expect(await isIntegrationUsable(definition)).toBe(false);
    });

    it('reports an unconfigured integration as unusable', async () => {
      const { definition } = makeDefinition();
      const { isIntegrationUsable } = await loadStatus(definition, {
        configured: false,
      });

      expect(await isIntegrationUsable(definition)).toBe(false);
    });

    it('does not consult check history — a failed check never gates the request path', async () => {
      const { check, definition } = makeDefinition();
      check.mockRejectedValue(
        new IntegrationError({
          code: 'upstream_unavailable',
          message: 'down',
        }),
      );

      const { getIntegrationStatus, isIntegrationUsable } =
        await loadStatus(definition);

      await getIntegrationStatus(definition, { force: true });

      // The upstream is down, but that is the upstream's business to report on
      // the next read — not a reason for this isolate to refuse to try.
      expect(await isIntegrationUsable(definition)).toBe(true);
    });
  });
});
