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

interface SetupOptions {
  /** The open note is a draft; the restored version was published. */
  draft?: boolean;
  /** Every save is refused: the note changed elsewhere. */
  refuseSaves?: boolean;
}

async function setup(
  page: Page,
  withVersions = true,
  options: SetupOptions = {},
) {
  const restores: unknown[] = [];
  const puts: Array<{ fields: Record<string, unknown> }> = [];
  const entry: {
    id: string;
    title: string;
    folder: string;
    path: string;
    href: string;
    revision: string;
    draft?: true;
    fields: Record<string, unknown>;
    body: string;
  } = {
    id: 'welcome',
    title: 'Field notes',
    folder: '',
    path: 'welcome.md',
    href: '/notes/welcome',
    revision: 'r1',
    ...(options.draft ? { draft: true as const } : {}),
    fields: options.draft ? { draft: true } : {},
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
        // As a server that does not keep the flag would: the version's
        // fields, published.
        entry.fields = {};
        delete entry.draft;
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
    if (request.method() === 'PUT') {
      if (options.refuseSaves) {
        // Someone else saved first: the store has moved on.
        entry.revision = 'r7';
        entry.body = '# Field notes\n\nRewritten elsewhere.\n';
        return route.fulfill({
          status: 409,
          json: { error: 'The note changed.', code: 'revision_conflict' },
        });
      }
      puts.push({ fields: request.postDataJSON().fields });
      return route.fulfill({
        json: { entry, result: { revision: 'r1', message: 'Saved' } },
      });
    }
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
  return { restores, puts };
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

test('restoring keeps the note a draft and its pill in step', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'the pill lives in the bar');
  const { restores, puts } = await setup(page, true, { draft: true });
  const pill = page.getByRole('group', { name: 'Who can read this note' });
  const draft = pill.getByRole('button', { name: 'Draft', exact: true });
  await expect(draft).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Version history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Version history' });
  await expect(dialog.getByText(/restore it again from history/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Restore this version' }).click();
  await expect(dialog).toBeHidden();
  expect(restores).toHaveLength(1);

  // The words came back; who can read the note did not change.
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toContainText('Keep following the thread.');
  await expect(draft).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => puts.at(-1)?.fields).toEqual({ draft: true });

  // And the pill still works: one press publishes.
  await pill.getByRole('button', { name: 'Published', exact: true }).click();
  await expect.poll(() => puts.at(-1)?.fields).toEqual({});
  await expect(page.locator('.studio-toast')).toContainText('Published!');
});

test('restore and the draft pill wait while a conflict pauses saving', async ({
  page,
}, info) => {
  const { restores } = await setup(page, true, { refuseSaves: true });
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await editor.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' More.');
  await expect(page.locator('.studio-conflict')).toContainText(
    'Someone edited this note elsewhere',
  );

  if (info.project.name === 'desktop') {
    const pill = page.getByRole('group', { name: 'Who can read this note' });
    await expect(pill).toHaveAttribute('title', /Saving is paused/);
    const draft = pill.getByRole('button', { name: 'Draft', exact: true });
    await expect(draft).toHaveAttribute('aria-disabled', 'true');
    // Forced: Playwright, like a person, treats it as disabled.
    await draft.click({ force: true });
    await expect(draft).toHaveAttribute('aria-pressed', 'false');
  }

  await openHistory(page, info.project.name === 'mobile');
  const dialog = page.getByRole('dialog', { name: 'Version history' });
  const restore = dialog.getByRole('button', { name: 'Restore this version' });
  await expect(restore).toHaveAttribute('aria-disabled', 'true');
  await expect(restore).toHaveAccessibleDescription(/Saving is paused/);
  await restore.dispatchEvent('click');
  await page.waitForTimeout(300);
  expect(restores).toHaveLength(0);
  await expect(dialog).toBeVisible();
});
