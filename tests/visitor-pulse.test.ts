import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hereLabel,
  parsePulse,
  pulseSentence,
  visitorsLabel,
} from '../src/components/visitors/pulse';

describe('visitor pulse labels', () => {
  it('says "just you" when nobody else is here', () => {
    expect(hereLabel(0)).toBe('just you here');
    expect(hereLabel(1)).toBe('just you here');
    expect(hereLabel(3)).toBe('3 here now');
    expect(hereLabel(1204)).toBe('1,204 here now');
  });

  it('counts visitors with the right plural', () => {
    expect(visitorsLabel(1)).toBe('1 visitor');
    expect(visitorsLabel(2)).toBe('2 visitors');
    expect(visitorsLabel(12045)).toBe('12,045 visitors');
  });

  it('reads as a sentence for a screen reader', () => {
    expect(pulseSentence({ here: 1, visitors: 40, today: 3 })).toBe(
      'You are the only one here right now. 40 visitors so far, 3 today.',
    );
    expect(pulseSentence({ here: 2, visitors: 40, today: 3 })).toMatch(
      /^2 people are here right now\./,
    );
  });

  it('accepts only a complete, non-negative pulse', () => {
    expect(parsePulse({ here: 1, visitors: 2, today: 1 })).toEqual({
      here: 1,
      visitors: 2,
      today: 1,
    });
    expect(parsePulse({ here: 1, visitors: 2 })).toBeNull();
    expect(parsePulse({ here: -1, visitors: 2, today: 1 })).toBeNull();
    expect(parsePulse({ here: '1', visitors: 2, today: 1 })).toBeNull();
    expect(parsePulse(null)).toBeNull();
  });
});

describe('recording a pulse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadRecordPulse(reply: unknown) {
    const redisCommand = vi.fn(async (_command: unknown[]) => reply);
    vi.doMock('../src/lib/server/core', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/lib/server/core')>()),
      redisCommand,
    }));
    const { recordPulse } = await import('../src/lib/server/visitors');
    return { recordPulse, redisCommand };
  }

  it('makes one Redis round trip, keyed by the visitor', async () => {
    const { recordPulse, redisCommand } = await loadRecordPulse([3, 120, 9]);
    const now = Date.UTC(2026, 10, 12, 8);
    await expect(recordPulse('network', 'browser', now)).resolves.toEqual({
      here: 3,
      visitors: 120,
      today: 9,
    });
    expect(redisCommand).toHaveBeenCalledOnce();
    const command = redisCommand.mock.calls[0]![0];
    expect(command.slice(2, 10)).toEqual([
      6,
      'visitors:here',
      'visitors:all',
      'visitors:day:2026-11-12',
      'visitors:day:2026-11-12:ids:network',
      `visitors:new-ids:${Math.floor(now / 60_000)}`,
      'visitors:day:2026-11-12:counted',
      'browser',
    ]);
    // ARGV: member, now, window, day TTL, network, per network, per minute.
    expect(command.slice(-3)).toEqual(['network', 24, 120]);
  });

  it('counts a page that sent no id as its network', async () => {
    const { recordPulse, redisCommand } = await loadRecordPulse([1, 1, 1]);
    await recordPulse('network');
    expect(redisCommand.mock.calls[0]![0][9]).toBe('network');
  });

  it('never reports fewer than the visitor asking', async () => {
    // A HyperLogLog estimate can round below the truth on tiny sets.
    const { recordPulse } = await loadRecordPulse([0, 0, 0]);
    await expect(recordPulse('fingerprint')).resolves.toEqual({
      here: 1,
      visitors: 1,
      today: 1,
    });
  });

  it('survives a malformed reply', async () => {
    const { recordPulse } = await loadRecordPulse('nonsense');
    await expect(recordPulse('fingerprint')).resolves.toEqual({
      here: 1,
      visitors: 1,
      today: 1,
    });
  });
});

describe('pulse route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadRoute(
    recordPulse = vi.fn(async (..._args: unknown[]) => ({
      here: 1,
      visitors: 1,
      today: 1,
    })),
  ) {
    vi.doMock('../src/lib/server/core', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/lib/server/core')>()),
      rejectIfStorageUnavailable: () => null,
      rejectIfSigningUnavailable: () => null,
      getClientFingerprint: async () => 'network',
      getVisitorKey: async (id: string) => `key(${id})`,
    }));
    vi.doMock('../src/lib/server/visitors', () => ({ recordPulse }));
    const { POST } = await import('../src/pages/api/pulse');
    return { POST, recordPulse };
  }

  const pulse = (
    origin = 'https://oddava.me',
    body?: unknown,
    agent = 'Mozilla/5.0',
  ) =>
    new Request('https://oddava.me/api/pulse', {
      method: 'POST',
      headers: {
        Origin: origin,
        'User-Agent': agent,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('counts a browser by its id alone, whatever network it is on', async () => {
    const { POST, recordPulse } = await loadRoute();
    const id = '0b6f1c2e-6a59-4c8e-9a3f-2d1e7a9b5c40';
    await POST({ request: pulse(undefined, { visitor: id }) } as never);
    expect(recordPulse).toHaveBeenCalledWith('network', `key(${id})`);
  });

  it.each([undefined, { visitor: 'not an id!' }, { visitor: 42 }])(
    'falls back to the network for %j',
    async (body) => {
      const { POST, recordPulse } = await loadRoute();
      const response = await POST({ request: pulse(undefined, body) } as never);
      expect(response.status).toBe(200);
      expect(recordPulse).toHaveBeenCalledWith('network', null);
    },
  );

  it('does not count crawlers', async () => {
    const { POST, recordPulse } = await loadRoute();
    const response = await POST({
      request: pulse(undefined, undefined, 'Googlebot/2.1'),
    } as never);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'not_counted',
    });
    expect(recordPulse).not.toHaveBeenCalled();
  });

  it('refuses another site padding the counts', async () => {
    const { POST, recordPulse } = await loadRoute();
    const response = await POST({
      request: pulse('https://evil.example'),
    } as never);
    expect(response.status).toBe(403);
    expect(recordPulse).not.toHaveBeenCalled();
  });

  it('answers with the counts, uncached', async () => {
    const { POST } = await loadRoute(
      vi.fn(async () => ({ here: 2, visitors: 9, today: 4 })),
    );
    const response = await POST({ request: pulse() } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      here: 2,
      visitors: 9,
      today: 4,
    });
  });

  it('degrades to a 503 when storage fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await loadRoute(
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    const response = await POST({ request: pulse() } as never);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'pulse_unavailable',
    });
  });
});
