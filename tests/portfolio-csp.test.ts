import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_CANVAS_STYLE,
  APPEARANCE_PREPAINT_SCRIPT,
} from '../src/lib/portfolio/appearance';
import {
  APPEARANCE_SCRIPT_HASH,
  APPEARANCE_STYLE_HASH,
  registerPortfolioCsp,
} from '../src/lib/portfolio/csp';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const hash = (source: string) =>
  `sha256-${createHash('sha256').update(source).digest('base64')}`;

function pageFiles(directory: string): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return pageFiles(file);
      return entry.name.endsWith('.astro') ? [file] : [];
    })
    .sort();
}

describe('portfolio CSP registration', () => {
  it('hashes the exact bytes Prepaint renders', () => {
    expect(APPEARANCE_STYLE_HASH).toBe(hash(APPEARANCE_CANVAS_STYLE));
    expect(APPEARANCE_SCRIPT_HASH).toBe(hash(APPEARANCE_PREPAINT_SCRIPT));
    const prepaint = read('src/components/portfolio/Prepaint.astro');
    expect(prepaint).toContain('set:html={APPEARANCE_CANVAS_STYLE}');
    expect(prepaint).toContain('set:html={APPEARANCE_PREPAINT_SCRIPT}');
  });

  it('registers one style and one script hash', () => {
    const csp = { insertScriptHash: vi.fn(), insertStyleHash: vi.fn() };
    registerPortfolioCsp(csp, true);
    expect(csp.insertStyleHash.mock.calls).toEqual([[APPEARANCE_STYLE_HASH]]);
    expect(csp.insertScriptHash.mock.calls).toEqual([[APPEARANCE_SCRIPT_HASH]]);
  });

  it('refuses a production render without the CSP API', () => {
    expect(() => registerPortfolioCsp(undefined, true)).toThrow(/Astro\.csp/);
    expect(() => registerPortfolioCsp(undefined, false)).not.toThrow();
  });

  // A streamed server-rendered page builds its CSP header after the page's
  // own frontmatter and before the layout renders, so a hash registered from
  // the layout or Prepaint would miss the header and the pre-paint would be
  // blocked. Every page on a layout that renders Prepaint — Portfolio, the
  // notes pages' NotesLayout, and the admin's Cabinet — registers in its
  // frontmatter instead.
  it('is called from the frontmatter of every page on a pre-painted layout', () => {
    const portfolioPages = pageFiles('src/pages').filter((file) =>
      /from '[^']*layouts\/(?:Portfolio|NotesLayout|Cabinet)\.astro'/.test(
        read(file),
      ),
    );
    expect(portfolioPages).toEqual(
      expect.arrayContaining([
        path.join('src', 'pages', 'about.astro'),
        path.join('src', 'pages', 'index.astro'),
        path.join('src', 'pages', 'projects', 'index.astro'),
        path.join('src', 'pages', 'admin', 'index.astro'),
        path.join('src', 'pages', 'admin', 'login.astro'),
        path.join('src', 'pages', 'admin', 'preview', '[...path].astro'),
        path.join('src', 'pages', 'notes', 'index.astro'),
        path.join('src', 'pages', 'notes', '[...path].astro'),
        path.join('src', 'pages', 'notes', 'graph.astro'),
        path.join('src', 'pages', 'notes', 'tag', '[...tag].astro'),
      ]),
    );
    for (const file of portfolioPages) {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(file))?.[1];
      expect(frontmatter, file).toMatch(
        /^registerPortfolioCsp\(Astro\.csp, import\.meta\.env\.PROD\);$/m,
      );
    }
  });

  it('is not also registered by the layout or Prepaint, which would duplicate it', () => {
    for (const file of [
      'src/layouts/Portfolio.astro',
      'src/layouts/NotesLayout.astro',
      'src/layouts/Cabinet.astro',
      'src/components/portfolio/Prepaint.astro',
    ]) {
      expect(read(file), file).not.toMatch(
        /insert(?:Script|Style)Hash|registerPortfolioCsp/,
      );
    }
  });
});
