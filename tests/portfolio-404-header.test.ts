import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

// The 404 borrows the portfolio header and nothing else: its sky, cat, copy
// and body styles stay exactly as they were, so every portfolio rule it
// picks up must stop at the header's own wrapper.
describe('the 404 header', () => {
  it('fills only the header slot of Base, which defaults to the old nav', () => {
    expect(read('src/pages/404.astro')).toMatch(
      /<ScopedHeader slot="header" \/>/,
    );
    const base = read('src/layouts/Base.astro');
    expect(base).toMatch(
      /Astro\.slots\.has\('header'\) \? <slot name="header" \/> : <SiteNav \/>/,
    );
  });

  it('scopes the portfolio to a wrapper, never <html>', () => {
    const scoped = read('src/components/portfolio/ScopedHeader.astro');
    expect(scoped).toMatch(/class="pf-scope"\s+data-site="portfolio"/);
    expect(scoped).toContain('data-appearance-root');
    expect(read('src/pages/404.astro')).not.toMatch(
      /Portfolio\.astro|Prepaint|data-site/,
    );
  });

  it('keeps the wrapper dark and leaves the root font size alone', () => {
    const tokens = read('src/styles/portfolio/_tokens.css');
    // Pinned dark: the wrapper sits on a dark sky whatever theme is saved.
    expect(tokens).toMatch(
      /:root\[data-site='portfolio'\]\[data-theme='dark'\],\s*\.pf-scope\[data-site='portfolio'\] \{/,
    );
    // Text size sets font-size on its element; on the wrapper that would
    // not reach the rem-sized header and must never reach <html> there.
    expect(tokens).toMatch(
      /:root\[data-site='portfolio'\]\[data-size='large'\] \{/,
    );
    expect(tokens).not.toMatch(/\.pf-scope[^{]*data-size/);
  });

  it('lets the controller load saved choices onto the wrapper', () => {
    const script = read('src/scripts/appearance.ts');
    expect(script).toContain(
      "querySelector<HTMLElement>('[data-appearance-root]')",
    );
    expect(script).toMatch(/if \(scoped && stored\)/);
  });
});
