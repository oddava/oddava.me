import { test, expect } from '@playwright/test';
import { mockAdmin } from './admin-mocks';

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank');
});

async function open(page: import('@playwright/test').Page) {
  const state = await mockAdmin(page);
  await page.goto('/tests/browser/admin.html');
  await expect(page.locator('.adm-project')).toHaveCount(4);
  return state;
}

test('approving takes the entry off the inbox, and undo puts it back', async ({
  page,
}) => {
  const state = await open(page);
  const pendingTab = page.getByRole('button', { name: /^pending/ });
  await expect(pendingTab).toContainText('3');

  await page.getByRole('button', { name: 'Approve mira' }).click();
  await expect(page.getByRole('button', { name: 'Approve mira' })).toHaveCount(
    0,
  );
  await expect(pendingTab).toContainText('2');
  expect(state.guestbook.find((e) => e.id === 'g1')?.status).toBe('approved');

  await page.getByRole('button', { name: 'undo' }).click();
  await expect(
    page.getByRole('button', { name: 'Approve mira' }),
  ).toBeVisible();
  expect(state.guestbook.find((e) => e.id === 'g1')?.status).toBe('pending');
});

test('a project moves with the arrow keys and saves once per move', async ({
  page,
}) => {
  const state = await open(page);
  const grip = page.getByRole('button', { name: /^Reorder Ishbay/ });
  await grip.focus();
  await page.keyboard.press('ArrowUp');

  await expect(page.locator('.adm-project__name').first()).toHaveText('Ishbay');
  await expect.poll(() => state.saves.length).toBe(1);
  // Focus stays on the moved row's grip, so the next press keeps moving it.
  await expect(
    page.getByRole('button', { name: /^Reorder Ishbay, position 1/ }),
  ).toBeFocused();
});

test('hiding a project is immediate and undoable', async ({ page }) => {
  const state = await open(page);
  const eye = page.getByRole('button', { name: 'Hide Ishbay from the page' });
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  expect(state.projects.find((p) => p.id === 'p2')?.hidden).toBe(true);

  await page.getByRole('button', { name: 'undo' }).click();
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  expect(state.projects.find((p) => p.id === 'p2')?.hidden).toBe(false);
});

test('focus moves on to the next entry after a decision', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Reject mira' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Approve tomasz' }),
  ).toBeFocused();
});

test('held arrow keys reorder without dropping presses', async ({ page }) => {
  const state = await open(page);
  await page.getByRole('button', { name: /^Reorder AniShows/ }).focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.adm-project__name').first()).toHaveText(
    'AniShows',
  );
  await expect.poll(() => state.saves.length).toBe(3);
  expect(state.conflicts).toBe(0);
  expect((state.projects[0] as { id: string }).id).toBe('p4');
});

test('the editor asks before discarding edits, and saves through the sheet', async ({
  page,
}) => {
  const state = await open(page);
  await page.getByRole('button', { name: 'Edit oddava.me' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  await sheet.getByLabel('description').fill('this site, rebuilt');
  await page.keyboard.press('Escape');
  await expect(sheet.getByText('discard your changes?')).toBeVisible();
  await sheet.getByRole('button', { name: 'keep editing' }).click();

  await sheet.getByRole('button', { name: 'save' }).click();
  await expect(sheet).toBeHidden();
  expect(state.projects.find((p) => p.id === 'p3')?.description).toBe(
    'this site, rebuilt',
  );
});

test('an integration switch acts at once, without a dialog', async ({
  page,
}) => {
  const state = await open(page);
  const spotify = page.getByRole('switch', { name: 'Spotify' });
  await expect(spotify).toBeChecked();
  await spotify.click();
  await expect(spotify).not.toBeChecked();
  expect(state.integrations.find((i) => i.id === 'spotify')?.enabled).toBe(
    false,
  );
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
