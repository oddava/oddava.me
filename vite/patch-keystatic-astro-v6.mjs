import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Patches @keystatic/astro for Astro v6 + Cloudflare adapter compatibility.
 *
 * 1. Wraps `context.locals.runtime.env` in a try-catch (removed in Astro v6).
 * 2. Forces the Node.js variant of @keystatic/core/api/generic in dev mode
 *    so that `storage: { kind: 'local' }` works (the Cloudflare adapter
 *    normally resolves the worker variant which stubs out fs-based storage).
 *
 *    The Cloudflare Vite plugin sets resolve.conditions to
 *    ["workerd", "worker", "module", "browser"] on the SSR environment,
 *    which causes the worker variant to be loaded instead of the node
 *    variant. We counteract this with three complementary strategies:
 *    - `config` hook: injects a resolve.alias at the root level
 *    - `resolveId` hook: intercepts bare-specifier resolution
 *    - `transform` hook: rewrites the import inside @keystatic/astro
 *
 * @returns {import('vite').Plugin}
 */
export function patchKeystaticAstroV6() {
  const envTarget =
    'const envVarsForCf = (_context$locals = context.locals) === null || _context$locals === void 0 || (_context$locals = _context$locals.runtime) === null || _context$locals === void 0 ? void 0 : _context$locals.env;';
  const envReplacement =
    'var envVarsForCf; try { envVarsForCf = (_context$locals = context.locals) === null || _context$locals === void 0 || (_context$locals = _context$locals.runtime) === null || _context$locals === void 0 ? void 0 : _context$locals.env; } catch (_) { envVarsForCf = undefined; }';

  /** @type {string | undefined} */
  let nodeGenericApiId;
  let isDev = false;

  /**
   * Resolves the absolute path to the Node.js variant of
   * @keystatic/core/api/generic once and caches it.
   * @returns {string | undefined}
   */
  function resolveNodeGenericApiPath() {
    if (nodeGenericApiId) return nodeGenericApiId;
    try {
      const req = createRequire(import.meta.url);
      const pkgPath = req.resolve('@keystatic/core/package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const entry = pkg.exports?.['./api/generic']?.node?.default;
      if (entry) {
        // Workerd import resolution expects forward slashes on Windows.
        nodeGenericApiId = resolve(dirname(pkgPath), entry).replace(/\\/g, '/');
        return nodeGenericApiId;
      }
    } catch {}
    return undefined;
  }

  return {
    name: 'patch-keystatic-astro-v6',
    enforce: 'pre',

    configResolved(config) {
      isDev = config.command === 'serve' && config.mode === 'development';
    },

    config(conf, { command }) {
      if (command !== 'serve') return;

      const nodePath = resolveNodeGenericApiPath();
      if (!nodePath) return;

      conf.resolve ||= {};
      conf.resolve.alias ||= {};

      const alias = conf.resolve.alias;
      if (Array.isArray(alias)) {
        alias.push({
          find: '@keystatic/core/api/generic',
          replacement: nodePath,
        });
      } else {
        alias['@keystatic/core/api/generic'] = nodePath;
      }
    },

    resolveId(id) {
      if (!isDev) return null;
      if (id !== '@keystatic/core/api/generic') return null;

      return resolveNodeGenericApiPath() ?? null;
    },

    transform(code, id) {
      if (!isDev) return null;
      if (!id.includes('@keystatic/astro')) return null;

      let modified = code;

      if (modified.includes(envTarget)) {
        modified = modified.replace(envTarget, envReplacement);
      }

      if (modified === code) return null;
      return { code: modified, map: null };
    },
  };
}
