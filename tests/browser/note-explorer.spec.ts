import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('public note indentation works with inline styles blocked by CSP', async ({
  page,
}) => {
  const component = await readFile(
    'src/components/garden/NoteExplorerNode.astro',
    'utf8',
  );
  // This component is SSR-only: unlike DOM style-property updates, its style
  // attributes are blocked by the public page's production policy.
  expect(component).not.toMatch(/\sstyle\s*=/);
  const css = await readFile('src/styles/components/_local-map.css', 'utf8');
  await page.route('**/note-explorer.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: css }),
  );
  const rows = Array.from(
    { length: 5 },
    (_, depth) =>
      `<li class="note-explorer__item" data-depth="${depth}"><a class="note-explorer__row note-explorer__file" href="#note-${depth}">Note ${depth}</a></li>`,
  ).join('');
  await page.route('**/note-explorer-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: {
        'Content-Security-Policy':
          "default-src 'none'; style-src 'self'; style-src-attr 'none'",
      },
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/note-explorer.css"></head><body><nav class="note-explorer"><ul>${rows}</ul></nav></body></html>`,
    }),
  );
  await page.goto('/note-explorer-fixture');
  const links = page.locator('.note-explorer__row');
  for (let depth = 0; depth < 5; depth++) {
    await expect(links.nth(depth)).toHaveCSS(
      'padding-left',
      `${24 + depth * 8}px`,
    );
  }
});
