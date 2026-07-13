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
    resolveCredentials: async () => ({ clientId: 'value' }),
    getCredentialStatuses: async () =>
      definition.credentials.map((field) => ({
        key: field.key,
        set: configured,
        source: configured ? 'env' : 'none',
      })),
    isConfigured: async () => configured,
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

  it('opens a circuit breaker after repeated failures and stops probing', async () => {
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
    expect(check).toHaveBeenCalledTimes(3);

    // The breaker is now open: an ordinary status read must not touch the API.
    const status = await getIntegrationStatus(definition);
    expect(check).toHaveBeenCalledTimes(3);
    expect(status.retryAt).toBeDefined();
    expect(status.state).toBe('error');
  });

  it('lets an explicit test punch through an open breaker', async () => {
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

    // The operator has just fixed it and wants to confirm — that must reach the API.
    check.mockResolvedValue({ state: 'ok', detail: 'Connected.' });
    const status = await getIntegrationStatus(definition, { force: true });

    expect(check).toHaveBeenCalledTimes(4);
    expect(status.state).toBe('ok');
    expect(status.retryAt).toBeUndefined();
  });

  it('does not trip the breaker on a credential problem', async () => {
    // These do not resolve on their own, but they also cost one cheap failed
    // request — and the operator is probably fixing them right now.
    const { check, definition } = makeDefinition();
    check.mockRejectedValue(
      new IntegrationError({
        code: 'invalid_credentials',
        message: 'Token revoked.',
      }),
    );

    const { getIntegrationStatus } = await loadStatus(definition);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await getIntegrationStatus(definition, { force: true });
    }

    const status = await getIntegrationStatus(definition, { force: true });
    expect(status.retryAt).toBeUndefined();
    expect(status.state).toBe('error');
  });

  it('contains a provider that throws a non-integration error', async () => {
    const { check, definition } = makeDefinition();
    check.mockRejectedValue(new Error('kaboom'));

    const { getIntegrationStatuses } = await loadStatus(definition);
    const [status] = await getIntegrationStatuses();

    expect(status.state).toBe('error');
    expect(status.detail).toBe('kaboom');
  });

  it('feeds a request-path failure back into the shared breaker', async () => {
    const { definition } = makeDefinition();
    const { isIntegrationUsable, recordIntegrationOutcome } =
      await loadStatus(definition);

    expect(await isIntegrationUsable(definition)).toBe(true);

    const error = new IntegrationError({
      code: 'upstream_unavailable',
      message: 'down',
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      recordIntegrationOutcome('spotify', { ok: false, error });
    }

    // The widget's own polling is what detected the outage; the next poll skips it.
    expect(await isIntegrationUsable(definition)).toBe(false);

    recordIntegrationOutcome('spotify', { ok: true });
    expect(await isIntegrationUsable(definition)).toBe(true);
  });

  it('stops request-path retries after an operator-action failure', async () => {
    const { definition } = makeDefinition();
    const {
      invalidateIntegrationStatus,
      isIntegrationUsable,
      recordIntegrationOutcome,
    } = await loadStatus(definition);

    recordIntegrationOutcome('spotify', {
      ok: false,
      error: new IntegrationError({
        code: 'invalid_credentials',
        message: 'Token revoked.',
      }),
    });

    expect(await isIntegrationUsable(definition)).toBe(false);

    invalidateIntegrationStatus('spotify');
    expect(await isIntegrationUsable(definition)).toBe(true);
  });
});
