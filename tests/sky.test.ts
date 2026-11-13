import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StarRecord } from '../src/lib/contracts';
import {
  getPublicStars,
  normalizeStar,
  parseSkyCoordinate,
  sanitizeStarWord,
  STAR_WORD_MAX_LENGTH,
  toPublicStar,
} from '../src/lib/server/sky';

const star = (overrides: Partial<StarRecord> = {}): StarRecord => ({
  id: 'star-1',
  x: 0.25,
  y: 0.5,
  createdAt: '2026-11-01T00:00:00.000Z',
  status: 'approved',
  ipFingerprint: 'private-fingerprint',
  userAgent: 'private-agent',
  ...overrides,
});

describe('sky coordinates', () => {
  it('accepts fractions of the sky, rounded to four places', () => {
    expect(parseSkyCoordinate(0)).toBe(0);
    expect(parseSkyCoordinate(1)).toBe(1);
    expect(parseSkyCoordinate(0.123456)).toBe(0.1235);
  });

  it.each([-0.01, 1.01, Number.NaN, Infinity, '0.5', null, undefined])(
    'rejects %j',
    (value) => {
      expect(parseSkyCoordinate(value)).toBeNull();
    },
  );
});

describe('star words', () => {
  it('trims, strips markup and caps the length', () => {
    expect(sanitizeStarWord('  hello  ')).toBe('hello');
    expect(sanitizeStarWord('a'.repeat(80))).toHaveLength(STAR_WORD_MAX_LENGTH);
    expect(sanitizeStarWord('<b>hi</b>')).not.toContain('<');
  });

  it('counts flags and joined emoji as one character each', () => {
    const family = '👨\u200d👩\u200d👧';
    const flag = '🇺🇿';
    const word = sanitizeStarWord(`${family}${flag}`.repeat(20));
    expect(word.startsWith(`${family}${flag}`)).toBe(true);
    // 24 whole characters: 12 families and 12 flags, nothing half cut.
    expect(word).toBe(`${family}${flag}`.repeat(12));
  });

  it('counts characters as a person does, never cutting an emoji', () => {
    const word = sanitizeStarWord('🌙'.repeat(30));
    expect(Array.from(word)).toHaveLength(STAR_WORD_MAX_LENGTH);
    expect(word).toBe('🌙'.repeat(STAR_WORD_MAX_LENGTH));
  });

  it('keeps emoji joiners but drops invisible padding and mark piles', () => {
    expect(sanitizeStarWord('a\u200bb\ufeffc')).toBe('abc');
    expect(sanitizeStarWord('👩\u200d🚀')).toBe('👩\u200d🚀');
    expect(sanitizeStarWord('e\u0301\u0301\u0301\u0301')).toBe(
      'e\u0301\u0301'.normalize('NFKC'),
    );
  });

  it('strips characters that flip the reading direction', () => {
    expect(sanitizeStarWord('hi\u202Eereh')).toBe('hiereh');
    expect(sanitizeStarWord('\u2066ok\u2069')).toBe('ok');
  });

  it('treats a non-string as no word', () => {
    expect(sanitizeStarWord(42)).toBe('');
    expect(sanitizeStarWord({ word: 'x' })).toBe('');
  });
});

describe('creating a star', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadCreateStar() {
    // The file's static import already loaded the real core; start fresh.
    vi.resetModules();
    vi.doMock('../src/lib/server/core', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/lib/server/core')>()),
      getClientFingerprint: async () => 'fingerprint',
    }));
    const { createStar } = await import('../src/lib/server/sky');
    return createStar;
  }

  it('approves a star without a word at once', async () => {
    const createStar = await loadCreateStar();
    const record = await createStar(
      new Request('https://x.test'),
      0.1,
      0.2,
      '',
    );
    expect(record).toMatchObject({ x: 0.1, y: 0.2, status: 'approved' });
    expect(record).not.toHaveProperty('word');
  });

  it('holds a star with a word for the moderator', async () => {
    const createStar = await loadCreateStar();
    const record = await createStar(
      new Request('https://x.test'),
      0.1,
      0.2,
      'hello',
    );
    expect(record).toMatchObject({ word: 'hello', status: 'pending' });
    expect(record.ipFingerprint).toBe('fingerprint');
    expect(record).not.toHaveProperty('userAgent');
  });

  it('approves the moderator’s own word as it lands', async () => {
    const createStar = await loadCreateStar();
    const record = await createStar(
      new Request('https://x.test'),
      0.1,
      0.2,
      'hello',
      { byModerator: true },
    );
    expect(record).toMatchObject({ word: 'hello', status: 'approved' });
  });
});

describe('normalizing stored stars', () => {
  it('round-trips a stored record', () => {
    const record = star({ word: 'hi', status: 'pending' });
    expect(normalizeStar(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it.each([
    null,
    'star',
    { ...star(), id: '' },
    { ...star(), x: 2 },
    { ...star(), y: 'top' },
    { ...star(), createdAt: undefined },
  ])('drops a record it cannot place: %j', (value) => {
    expect(normalizeStar(value)).toBeNull();
  });

  it('treats an unknown status as pending, never as approved', () => {
    expect(normalizeStar({ ...star(), status: 'weird' })?.status).toBe(
      'pending',
    );
  });
});

describe('the public sky', () => {
  it('shows pending stars without their word and hides rejected ones', () => {
    const stars = getPublicStars([
      star({ id: 'approved', word: 'hello' }),
      star({ id: 'pending', word: 'waiting', status: 'pending' }),
      star({ id: 'rejected', word: 'spam', status: 'rejected' }),
      star({ id: 'quiet' }),
    ]);
    expect(stars.map((s) => s.id)).toEqual(['approved', 'pending', 'quiet']);
    expect(stars.find((s) => s.id === 'approved')?.word).toBe('hello');
    expect(stars.find((s) => s.id === 'pending')).not.toHaveProperty('word');
  });

  it('never says who left a star, or exactly when', () => {
    expect(
      toPublicStar(star({ word: 'hi', createdAt: '2026-11-01T08:17:42.123Z' })),
    ).toEqual({
      id: 'star-1',
      x: 0.25,
      y: 0.5,
      word: 'hi',
      createdAt: '2026-11-01T08:17:00.000Z',
    });
  });
});

describe('client networks', () => {
  it('keeps an IPv4 address whole', async () => {
    const { clientNetwork } = await import('../src/lib/server/core/signing');
    expect(clientNetwork('203.0.113.7')).toBe('203.0.113.7');
    expect(clientNetwork('unknown')).toBe('unknown');
  });

  it('names an IPv6 visitor by their /64', async () => {
    const { clientNetwork } = await import('../src/lib/server/core/signing');
    const a = clientNetwork('2001:db8:85a3:12:1:2:3:4');
    expect(a).toBe('2001:db8:85a3:12::/64');
    expect(clientNetwork('2001:0db8:85a3:0012:ffff:0:0:9')).toBe(a);
    expect(clientNetwork('2001:db8:85a3:12::9')).toBe(a);
    expect(clientNetwork('2001:DB8:85A3:12::1%eth0')).toBe(a);
    expect(clientNetwork('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientNetwork('::1')).toBe('0:0:0:0::/64');
  });

  it('reads an IPv4-mapped address as IPv4', async () => {
    const { clientNetwork } = await import('../src/lib/server/core/signing');
    expect(clientNetwork('::ffff:198.51.100.4')).toBe('198.51.100.4');
  });

  it('leaves something it cannot parse as it is', async () => {
    const { clientNetwork } = await import('../src/lib/server/core/signing');
    expect(clientNetwork('fe80:zz::1')).toBe('fe80:zz::1');
  });
});
