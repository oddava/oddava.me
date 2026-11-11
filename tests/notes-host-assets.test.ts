/**
 * The hidden-asset hazard of serving the notes host from the same Worker.
 *
 * Cloudflare answers a request for a prerendered page from the asset store
 * before the Worker runs, on every hostname bound to the Worker. Without
 * `assets.run_worker_first`, notes.oddava.me/ would be the apex home page and
 * a note named `about` would be the apex about page. These tests fail when a
 * prerendered route is not routed through the Worker first, or when the Worker
 * entry that maps the notes host is no longer the one Wrangler runs.
 *
 * The behaviour itself was checked against `astro preview` (workerd with the
 * real asset rules); see docs/notes-host.md.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mapNotesHostPath } from '../src/lib/notes-host';

const repoDir = fileURLToPath(new URL('../', import.meta.url));
const pagesDir = join(repoDir, 'src/pages');

interface WranglerConfig {
  main?: string;
  assets?: { run_worker_first?: boolean | string[] };
}

/** wrangler.jsonc allows full-line comments and trailing commas. */
function readWranglerConfig(): WranglerConfig {
  const source = readFileSync(join(repoDir, 'wrangler.jsonc'), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(source) as WranglerConfig;
}

/** Cloudflare's rule syntax: `*` matches anything, `!` excludes. */
function runsWorkerFirst(rules: boolean | string[], pathname: string) {
  if (typeof rules === 'boolean') return rules;
  const matches = (pattern: string) =>
    new RegExp(
      `^${pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    ).test(pathname);
  const included = rules.filter((rule) => !rule.startsWith('!'));
  const excluded = rules
    .filter((rule) => rule.startsWith('!'))
    .map((rule) => rule.slice(1));
  return included.some(matches) && !excluded.some(matches);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every route Astro prerenders into the asset store, as a URL path. */
function prerenderedRoutes(): string[] {
  return walk(pagesDir)
    .filter((file) => /\.(astro|ts)$/.test(file))
    .filter((file) =>
      /export const prerender = true/.test(readFileSync(file, 'utf8')),
    )
    .map((file) => {
      const route = relative(pagesDir, file)
        .replaceAll('\\', '/')
        .replace(/\.(astro|ts)$/, '')
        .replace(/(^|\/)index$/, '');
      if (route.includes('[')) {
        throw new Error(
          `${file}: a prerendered dynamic route needs its paths listed in run_worker_first by hand`,
        );
      }
      return `/${route}`;
    });
}

describe('notes host: prerendered-asset shadowing', () => {
  const config = readWranglerConfig();
  const rules = config.assets?.run_worker_first ?? false;
  const routes = prerenderedRoutes();

  it('runs the Worker entry that maps the notes host', () => {
    expect(config.main).toBe('./src/worker.ts');
  });

  it('finds the prerendered routes it is guarding', () => {
    expect(routes).toEqual(
      expect.arrayContaining(['/about', '/links', '/sitemap-index.xml']),
    );
  });

  it('sends the notes host root to the Worker, not the apex home page', () => {
    expect(runsWorkerFirst(rules, '/')).toBe(true);
    expect(mapNotesHostPath('/')).toEqual({
      kind: 'serve',
      pathname: '/notes',
    });
  });

  it.each(routes)(
    'sends prerendered %s to the Worker first, so a note of that name is not shadowed',
    (route) => {
      expect(runsWorkerFirst(rules, route)).toBe(true);
      if (route !== '/') {
        expect(mapNotesHostPath(route)).toEqual({
          kind: 'serve',
          pathname: `/notes${route}`,
        });
      }
    },
  );

  it('leaves built assets and public files to the asset store', () => {
    // Public files are shared by both hosts. In `astro dev` the asset binding
    // does not serve public/, so routing them through the Worker would 404.
    for (const path of [
      '/_astro/index.abc123.js',
      '/fonts/jetbrains-mono-latin-400-normal.woff2',
      ...readdirSync(join(repoDir, 'public')).map((name) => `/${name}`),
    ]) {
      if (path === '/_headers') continue;
      expect(runsWorkerFirst(rules, path), path).toBe(false);
    }
  });

  it('matches rules the way Cloudflare does', () => {
    expect(runsWorkerFirst(['/*', '!/_astro/*'], '/about')).toBe(true);
    expect(runsWorkerFirst(['/*', '!/_astro/*'], '/_astro/a.js')).toBe(false);
    expect(runsWorkerFirst(['/'], '/about')).toBe(false);
    expect(runsWorkerFirst(true, '/x')).toBe(true);
  });
});
