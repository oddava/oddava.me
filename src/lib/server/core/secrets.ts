// No imports, by design: the workerd dev bridge in vite/local-redis-dev-proxy.mjs
// imports this file from plain Node, which cannot resolve an extensionless
// relative import.
const PLACEHOLDER_SECRETS = new Set([
  'change-me',
  'changeme',
  'replace-me',
  'replace_me',
]);

/**
 * Normalizes a secret without deciding whether the value is configured:
 * trims whitespace and maps empty or non-string values to undefined.
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
