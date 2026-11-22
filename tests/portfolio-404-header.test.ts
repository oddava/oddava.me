import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('the 404 page', () => {
  it('renders on the minimal portfolio shell with a real 404 status and noindex', () => {
    const page = read('src/pages/404.astro');
    expect(page).toContain("import Portfolio from '@layouts/Portfolio.astro';");
    expect(page).toContain('registerPortfolioCsp(Astro.csp');
    expect(page).toContain('Astro.response.status = 404;');
    expect(page).toContain('name="robots" content="noindex"');
    expect(page).toContain('header={false}');
  });

  it('offers links back to home and notes without hardcoded /notes literals', () => {
    const page = read('src/pages/404.astro');
    expect(page).toContain('href="/"');
    expect(page).toContain('href={notesIndexUrl()}');
  });
});
