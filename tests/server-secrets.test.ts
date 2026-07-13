import { describe, expect, it } from 'vitest';
import {
  credentialFingerprint,
  firstConfiguredSecret,
  isConfiguredSecret,
  normalizeSecret,
} from '../src/lib/server/secrets';

describe('server secret boundaries', () => {
  it('normalizes values and rejects recognizable placeholders', () => {
    expect(normalizeSecret('  configured-value  ')).toBe('configured-value');
    expect(normalizeSecret('  ')).toBeUndefined();
    expect(normalizeSecret(null)).toBeUndefined();

    for (const placeholder of [
      'your_client_secret',
      'PUT_IT_HERE',
      'change-me',
      'replace_me',
    ]) {
      expect(isConfiguredSecret(placeholder)).toBe(false);
    }
    expect(isConfiguredSecret('an-actual-secret')).toBe(true);
  });

  it('returns the first configured fallback in normalized form', () => {
    expect(
      firstConfiguredSecret('your_primary_secret', '  fallback-secret  '),
    ).toBe('fallback-secret');
    expect(firstConfiguredSecret(undefined, '', 'replace-me')).toBeUndefined();
  });

  it('creates stable, secret-independent cache keys', async () => {
    const first = await credentialFingerprint(['client', 'secret']);
    const second = await credentialFingerprint(['client', 'secret']);
    const rotated = await credentialFingerprint(['client', 'rotated']);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
    expect(first).not.toBe(rotated);
    expect(first).not.toContain('secret');
  });
});
