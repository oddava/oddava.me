import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_CANVAS_STYLE,
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  APPEARANCE_PREFS,
  APPEARANCE_PREPAINT_SCRIPT,
  APPEARANCE_STORAGE_KEY,
  sanitizeAppearance,
} from '../src/lib/portfolio/appearance';

/** Runs the real pre-paint string against a fake document and storage. */
function runPrepaint(stored: string | null | (() => never)) {
  const attributes: Record<string, string> = {};
  const window = {
    localStorage: {
      getItem(key: string) {
        expect(key).toBe(APPEARANCE_STORAGE_KEY);
        if (typeof stored === 'function') return stored();
        return stored;
      },
    },
  };
  const document = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attributes[name] = value;
      },
    },
  };
  new Function('window', 'document', APPEARANCE_PREPAINT_SCRIPT)(
    window,
    document,
  );
  return attributes;
}

describe('appearance preferences', () => {
  it('has two keys whose first value is the default', () => {
    expect(APPEARANCE_KEYS).toEqual(['theme', 'ink']);
    expect(APPEARANCE_DEFAULTS).toEqual({ theme: 'system', ink: 'ai' });
  });

  it('keeps only known keys with allowed values', () => {
    expect(
      sanitizeAppearance({ theme: 'dark', ink: 'coral', extra: 'x' }),
    ).toEqual({ theme: 'dark' });
    expect(sanitizeAppearance({ ink: 'matcha', theme: 9 })).toEqual({
      ink: 'matcha',
    });
    // Saved choices from the six-preference panel drop the retired keys.
    expect(
      sanitizeAppearance({
        theme: 'light',
        read: 'serif',
        size: 'large',
        density: 'compact',
        motion: 'reduced',
      }),
    ).toEqual({ theme: 'light' });
    expect(sanitizeAppearance(null)).toEqual({});
    expect(sanitizeAppearance('dark')).toEqual({});
    expect(sanitizeAppearance(['dark'])).toEqual({});
  });
});

describe('pre-paint script', () => {
  it('applies a full saved choice before paint', () => {
    const saved = { theme: 'dark', ink: 'sakura' };
    expect(runPrepaint(JSON.stringify(saved))).toEqual({
      'data-theme': 'dark',
      'data-ink': 'sakura',
    });
  });

  it('agrees with sanitizeAppearance on bogus and partial values', () => {
    const samples: unknown[] = [
      { theme: 'vellum', ink: 'coral' },
      { theme: 'light' },
      { ink: ['sora'], density: 'compact', size: 'large' },
    ];
    for (const sample of samples) {
      const expected = Object.fromEntries(
        Object.entries(sanitizeAppearance(sample)).map(([key, value]) => [
          `data-${key}`,
          value,
        ]),
      );
      expect(runPrepaint(JSON.stringify(sample))).toEqual(expected);
    }
  });

  it('changes nothing for missing, malformed, non-object or blocked storage', () => {
    expect(runPrepaint(null)).toEqual({});
    expect(runPrepaint('{"theme":"dark"')).toEqual({});
    expect(runPrepaint('"dark"')).toEqual({});
    expect(runPrepaint('["dark"]')).toEqual({});
    expect(runPrepaint('null')).toEqual({});
    expect(runPrepaint('{"__proto__":{"theme":"dark"}}')).toEqual({});
    expect(
      runPrepaint(() => {
        throw new DOMException('denied', 'SecurityError');
      }),
    ).toEqual({});
  });

  it('carries the same allow-list as the module', () => {
    expect(APPEARANCE_PREPAINT_SCRIPT).toContain(
      JSON.stringify(APPEARANCE_PREFS),
    );
  });

  // The CSP registers these by hash: the bytes must not vary per render.
  it('is fixed text with no per-render parts and no inline style', () => {
    const hash = (source: string) =>
      createHash('sha256').update(source).digest('base64');
    expect(hash(APPEARANCE_PREPAINT_SCRIPT)).toBe(
      hash(String(APPEARANCE_PREPAINT_SCRIPT)),
    );
    expect(APPEARANCE_PREPAINT_SCRIPT).not.toMatch(/style|eval|innerHTML/);
    expect(APPEARANCE_CANVAS_STYLE).not.toMatch(/url\(|@import|expression/);
  });
});
