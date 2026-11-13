import { test, expect, type Page } from '@playwright/test';

const NOW = Date.now();
const CURRENT =
  '# Field notes\n\nThe good ideas are usually hiding in the ordinary.\n\nA brand new closing thought.\n';
const OLD =
  '# Field notes\n\nThe good ideas are usually hiding in the ordinary.\n\nKeep following the thread.\n';

const versions = [
  {
    id: 'a'.repeat(16),
    at: new Date(NOW - 12 * 60_000).toISOString(),
    recordedAt: NOW - 8 * 60_000,
    reason: 'autosave',
    bytes: OLD.length,
  },
  {
    id: 'b'.repeat(16),
    at: new Date(NOW - 26 * 3_600_000).toISOString(),
    recordedAt: NOW - 26 * 3_600_000,
    reason: 'pre-restore',
    bytes: 40,
  },
];

async function setup(page: Page, withVersions = true) {
  const restores: unknown[] = [];
  const entry = {
    id: 'welcome',
    title: 'Field notes',
    folder: '',
    path: 'welcome.md',
    href: '/notes/welcome',
    revision: 'r1',
    fields: {},
    body: CURRENT,
  };
  const collection = {
    id: 'notes',
    label: 'Notes',
    singularLabel: 'Note',
    body: true,
    count: 1,
  };
  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/collections'))
      return route.fulfill({ json: { collections: [collection] } });
    if (path.includes('social-card'))
      return route.fulfill({ json: { cards: [] } });
    if (path.endsWith('/history')) {
      if (request.method() === 'POST') {
        restores.push(request.postDataJSON());
        entry.body = OLD;
        entry.revision = 'r2';
        return route.fulfill({
          json: { entry, result: { revision: 'r2', message: 'ok' } },
        });
      }
      const wanted = url.searchParams.get('version');
      if (!wanted)
        return route.fulfill({
          json: { versions: withVersions ? versions : [] },
        });
      return route.fulfill({
        json: {
          version: {
            ...versions.find((version) => version.id === wanted),
            fields: {},
            body: OLD,
          },
        },
      });
    }
    if (path.endsWith('/notes'))
      return route.fulfill({
        json: { collection, entries: [entry], folders: [] },
      });
    if (request.method() === 'PUT')
      return route.fulfill({
        json: { entry, result: { revision: 'r1', message: 'Saved' } },
      });
    return route.fulfill({ json: { collection, entry } });
  });
  await page.goto('/tests/browser/');
  const desktopFile = page.locator('[data-tree-key="entry:welcome"]');
  const mobileFile = page.locator('.studio-mfiles__open').filter({
    hasText: 'welcome',
  });
  await expect(desktopFile.or(mobileFile)).toBeVisible();
  if (await desktopFile.isVisible()) await desktopFile.click();
  else await mobileFile.click();
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toBeVisible();
  return { restores };
}

/**
 * Opens the history the way the layout offers it: the bar's button, or on a
 * phone the row in the note's ⋯ sheet. Returns what focus comes back to.
 */
async function openHistory(page: Page, isMobile: boolean) {
  if (!isMobile) {
    const button = page.getByRole('button', { name: 'Version history' });
    await button.click();
    return button;
  }
  const more = page.getByRole('button', { name: 'Note actions', exact: true });
  await more.click();
  await page
    .locator('.studio-sheet')
    .getByRole('button', { name: 'Version history' })
    .click();
  return more;
}

test('history lists versions, shows what restoring changes, and restores', async ({
  page,
  isMobile,
}, info) => {
  const { restores } = await setup(page);
  const open = await openHistory(page, isMobile);

  const dialog = page.getByRole('dialog', { name: 'Version history' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Today', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Before a restore')).toBeVisible();
  // Under its day's heading a version is a time of day; the day is not said twice.
  await expect(dialog.getByText('Yesterday', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Yesterday,/)).toHaveCount(0);

  // The newest version is selected, and its changes are against the note on screen.
  await expect(dialog.locator('ins')).toContainText(
    'Keep following the thread.',
  );
  await expect(dialog.locator('del')).toContainText(
    'A brand new closing thought.',
  );
  await page.screenshot({
    path: `test-results/history-${info.project.name}.png`,
  });

  await dialog.getByRole('button', { name: 'Full text' }).click();
  await expect(
    dialog.getByRole('region', { name: 'Version text' }),
  ).toContainText('Keep following the thread.');

  await dialog.getByRole('button', { name: 'Restore this version' }).click();
  await expect(dialog).toBeHidden();
  expect(restores).toEqual([{ versionId: 'a'.repeat(16), revision: 'r1' }]);
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toContainText('Keep following the thread.');
  await expect(open).toBeFocused();
});

test('escape closes the history and gives focus back', async ({
  page,
  isMobile,
}) => {
  await setup(page);
  const open = await openHistory(page, isMobile);
  await expect(
    page.getByRole('dialog', { name: 'Version history' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Version history' }),
  ).toBeHidden();
  await expect(open).toBeFocused();
});

test('a note with no history says so kindly', async ({ page, isMobile }) => {
  await setup(page, false);
  await openHistory(page, isMobile);
  await expect(page.getByText('Nothing to go back to yet')).toBeVisible();
});

test('the palette opens the history', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The phone reaches history from the note actions.');
  await setup(page);
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox').fill('version hist');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Version history' }),
  ).toBeVisible();
});
