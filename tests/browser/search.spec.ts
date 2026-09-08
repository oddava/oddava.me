import { expect, test } from '@playwright/test';

test('search shows pending feedback, empty results, and errors', async ({
  page,
}) => {
  let respond: (() => void) | undefined;
  await page.route('**/api/notes/search?*', async (route) => {
    await new Promise<void>((resolve) => {
      respond = resolve;
    });
    await route.fulfill({ json: { results: [] } });
  });
  await page.goto('/tests/browser/search.html');
  await expect(
    page.getByRole('button', { name: 'Find a note' }),
  ).not.toBeFocused();
  await page.getByRole('button', { name: 'Find a note' }).click();
  await page.getByRole('combobox').fill('missing');
  await expect(page.getByRole('status')).toHaveText('Searching…');
  await expect(
    page.locator('.note-search__field .note-search__loading'),
  ).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-loading');
  await expect(page.locator('.site-nav > .loading-indicator')).toHaveCSS(
    'opacity',
    '0',
  );
  await expect.poll(() => Boolean(respond)).toBe(true);
  respond!();
  await expect(page.getByRole('status')).toHaveText('No notes found.');
  await expect(page.locator('.note-search__loading')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-loading');
  await page.unroute('**/api/notes/search?*');
  await page.route('**/api/notes/search?*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await page.getByRole('combobox').fill('retry');
  await expect(page.getByRole('status')).toContainText('Search is unavailable');
  await expect(page.locator('.note-search__loading')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-loading');
});

test('changing a query removes stale results and traps focus; reduced-motion close restores it', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/notes/search?*', (route) =>
    route.fulfill({
      json: {
        results: [
          {
            id: 'one',
            title: 'First note',
            href: '/notes/one',
            summary: '',
            tags: [],
            updated: '',
          },
        ],
      },
    }),
  );
  await page.goto('/tests/browser/search.html');
  await page.getByRole('button', { name: 'Find a note' }).click();
  await page.getByRole('combobox').fill('first');
  await expect(page.getByRole('option')).toHaveText(/First note/);
  await page.getByRole('combobox').press('Shift+Tab');
  await expect(page.getByRole('option')).toBeFocused();
  await page.getByRole('option').press('Tab');
  await expect(page.getByRole('combobox')).toBeFocused();
  await page.getByRole('combobox').fill('');
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.getByRole('combobox').press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find a note' })).toBeFocused();
  await expect(page.locator('body')).not.toHaveClass(/note-search-open/);
});
