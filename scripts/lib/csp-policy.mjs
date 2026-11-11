/**
 * The rules every emitted Content-Security-Policy must meet. Shared by the
 * build verifier (over each prerendered page's meta policy) and its unit test.
 *
 * - Scripts are hash-only: `script-src` (and any `script-src-elem`/`-attr`)
 *   never carries `'unsafe-inline'`, `'unsafe-eval'`, a wildcard or a scheme
 *   source, and carries at least one generated hash.
 * - Style elements are hash-only: `style-src`/`style-src-elem` never carry
 *   `'unsafe-inline'`.
 * - `'unsafe-inline'` may appear in exactly one place: `style-src-attr`, for
 *   inline `style` attributes.
 */

/** @param {string} policy */
export function parseCspPolicy(policy) {
  /** @type {Map<string, string[]>} */
  const directives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/).filter(Boolean);
    if (name) directives.set(name.toLowerCase(), values);
  }
  return directives;
}

const LOOSE_SCRIPT_SOURCES = new Set([
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'unsafe-hashes'",
  "'wasm-unsafe-eval'",
  '*',
  'http:',
  'https:',
  'data:',
  'blob:',
]);

/**
 * @param {string} policy
 * @returns {string[]} the rules this policy breaks; empty when it is sound
 */
export function cspPolicyFailures(policy) {
  const failures = [];
  const directives = parseCspPolicy(policy);
  const script = directives.get('script-src');
  if (!script) failures.push('no script-src directive');
  for (const name of ['script-src', 'script-src-elem', 'script-src-attr']) {
    for (const value of directives.get(name) ?? []) {
      if (LOOSE_SCRIPT_SOURCES.has(value.toLowerCase())) {
        failures.push(`${name} allows ${value}`);
      }
    }
  }
  if (script && !script.some((value) => /^'sha(256|384|512)-/.test(value))) {
    failures.push('script-src has no generated hashes');
  }
  const style = directives.get('style-src');
  if (!style) failures.push('no style-src directive');
  for (const name of ['style-src', 'style-src-elem']) {
    for (const value of directives.get(name) ?? []) {
      if (value.toLowerCase() === "'unsafe-inline'") {
        failures.push(`${name} allows 'unsafe-inline'`);
      }
    }
  }
  const attr = directives.get('style-src-attr') ?? [];
  for (const value of attr) {
    if (value !== "'unsafe-inline'" && value !== "'self'") {
      failures.push(`style-src-attr allows ${value}`);
    }
  }
  if (directives.get('object-src')?.join(' ') !== "'none'") {
    failures.push("object-src is not 'none'");
  }
  return failures;
}
