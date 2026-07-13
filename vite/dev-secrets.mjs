const PLACEHOLDER_SECRETS = new Set([
  'change-me',
  'changeme',
  'replace-me',
  'replace_me',
]);

/** @param {unknown} value */
function normalizeConfiguredSecret(value) {
  if (typeof value !== 'string') return undefined;
  const secret = value.trim();
  if (!secret) return undefined;

  const normalized = secret.toLowerCase();
  if (
    normalized.startsWith('your_') ||
    normalized.endsWith('_here') ||
    PLACEHOLDER_SECRETS.has(normalized)
  ) {
    return undefined;
  }
  return secret;
}

/** @param {...unknown} values */
export function firstConfiguredSecret(...values) {
  for (const value of values) {
    const secret = normalizeConfiguredSecret(value);
    if (secret) return secret;
  }
  return undefined;
}
