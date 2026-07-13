const PLACEHOLDER_SECRETS = new Set([
  'change-me',
  'changeme',
  'replace-me',
  'replace_me',
]);

/**
 * Normalizes a secret without deciding whether the value is configured. This
 * is useful when persisting write-only credentials where an empty value means
 * "remove the override".
 */
export function normalizeSecret(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

/**
 * Example environment files intentionally contain recognizable placeholders.
 * Rejecting them at every authentication boundary keeps a copied example file
 * from silently becoming a valid credential set.
 */
export function isConfiguredSecret(value: string | undefined): boolean {
  const secret = normalizeSecret(value);
  if (!secret) return false;

  const normalized = secret.toLowerCase();
  return (
    !normalized.startsWith('your_') &&
    !normalized.endsWith('_here') &&
    !PLACEHOLDER_SECRETS.has(normalized)
  );
}

/** Returns the first configured value, normalized for direct use. */
export function firstConfiguredSecret(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    const normalized = normalizeSecret(value);
    if (normalized && isConfiguredSecret(normalized)) return normalized;
  }
  return undefined;
}

/**
 * Derives a stable, non-reversible key for credential-dependent caches. A
 * cryptographic digest makes accidental collisions negligible and never keeps
 * the raw joined secret as the cache key.
 */
export async function credentialFingerprint(
  values: Array<string | undefined>,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    values.map((value) => value ?? '').join('\u0000'),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
