import { test, expect, type Page } from '@playwright/test';

const paragraphs = Array.from(
  { length: 40 },
  (_, index) => `Line ${index + 1} of a long quiet page.`,
);
const body = `# Calm writing\n\n${paragraphs.join('\n\n')}\n`;

// Just enough of the content API for one note to open and autosave.
async function setup(page: Page) {
  const entry = {
    id: 'welcome',
    title: 'Calm writing',
    folder: '',
    path: 'welcome.md',
    href: '/notes/welcome',
    revision: 'r1',
    fields: {},
    body,
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
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/collections'))
      return route.fulfill({ json: { collections: [collection] } });
    if (path.includes('social-card'))
      return route.fulfill({ json: { cards: [] } });
    if (path.endsWith('/notes'))
      return route.fulfill({
        json: { collection, entries: [entry], folders: [] },
      });
    if (request.method() === 'PUT') {
      entry.revision += 'n';
      return route.fulfill({
        json: { entry, result: { revision: entry.revision, message: 'Saved' } },
      });
    }
    return route.fulfill({ json: { collection, entry } });
  });
  await page.goto('/tests/browser/');
}

async function openNote(page: Page) {
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const desktopFile = page.locator('[data-tree-key="entry:welcome"]');
  const mobileFile = page
    .locator('.studio-mfiles__open')
    .filter({ hasText: 'welcome' });
  // A reload restores the note that was open, so there may be no file to click.
  await expect(editor.or(desktopFile).or(mobileFile).first()).toBeVisible();
  if (!(await editor.isVisible())) {
    if (await desktopFile.isVisible()) await desktopFile.click();
    else await mobileFile.click();
  }
  await expect(editor).toBeVisible();
}

const root = (page: Page) => page.locator('html');

test('the Aa popover sets text size and line width, remembers them, and gives focus back', async ({
  page,
}) => {
  await setup(page);
  await openNote(page);

  const trigger = page.getByRole('button', { name: 'Page style' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Page style' });
  await expect(dialog).toBeVisible();
  // The popover takes focus on the current size, so arrows work at once.
  await expect(dialog.getByRole('radio', { name: 'Medium' })).toBeFocused();

  const before = await page
    .locator('.studio-rich-content.prose p')
    .first()
    .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  await dialog.getByRole('radio', { name: 'Large' }).check();
  await dialog.getByRole('radio', { name: 'Wide' }).check();
  await expect(root(page)).toHaveAttribute('data-studio-text', 'lg');
  await expect(root(page)).toHaveAttribute('data-studio-measure', 'wide');
  const after = await page
    .locator('.studio-rich-content.prose p')
    .first()
    .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(after).toBeGreaterThan(before);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.reload();
  await openNote(page);
  await expect(root(page)).toHaveAttribute('data-studio-text', 'lg');
  await expect(root(page)).toHaveAttribute('data-studio-measure', 'wide');
});

test('focus mode hides the chrome, dims all but the block being written, and Escape leaves', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The phone enters focus mode from the Aa popover.');
  await setup(page);
  await openNote(page);

  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await editor.locator('p', { hasText: 'Line 3 of' }).click();
  await page.getByRole('button', { name: 'Focus mode' }).click();
  await expect(root(page)).toHaveAttribute('data-studio-focus', 'on');
  await expect(page.locator('.studio-bar')).toHaveCSS('opacity', '0');
  await expect(page.locator('.studio-sidebar')).toBeHidden();

  // 41 blocks (the title and 40 lines); only the one under the caret is lit.
  await editor.locator('p', { hasText: 'Line 3 of' }).click();
  await expect(page.locator('.studio-focus-dim')).toHaveCount(40);
  await expect(editor.locator('p', { hasText: 'Line 3 of' })).not.toHaveClass(
    /studio-focus-dim/,
  );

  // The pointer at the top edge brings the bar back, without leaving the mode.
  await page.mouse.move(600, 10);
  await expect(page.locator('.studio-bar')).toHaveCSS('opacity', '1');
  await expect(root(page)).toHaveAttribute('data-studio-focus', 'on');

  await editor.locator('p', { hasText: 'Line 3 of' }).click();
  await page.keyboard.press('Escape');
  await expect(root(page)).not.toHaveAttribute('data-studio-focus', 'on');
  await expect(page.locator('.studio-focus-dim')).toHaveCount(0);
  await expect(page.locator('.studio-bar')).toHaveCSS('opacity', '1');
  await expect(page.locator('.studio-sidebar')).toBeVisible();
});

test('the shortcut toggles focus mode, and the spotlight can keep a whole block lit', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Needs a hardware keyboard.');
  await setup(page);
  await openNote(page);
  await page
    .getByRole('textbox', { name: 'Note editor' })
    .locator('p', { hasText: 'Line 3 of' })
    .click();

  await page.keyboard.press('Control+Shift+F');
  await expect(root(page)).toHaveAttribute('data-studio-focus', 'on');
  await page.keyboard.press('Control+Shift+F');
  await expect(root(page)).not.toHaveAttribute('data-studio-focus', 'on');

  await page.getByRole('button', { name: 'Page style' }).click();
  await page.getByRole('radio', { name: 'Off' }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Note editor' }).click();
  await page.keyboard.press('Control+Shift+F');
  await expect(root(page)).toHaveAttribute('data-studio-focus', 'on');
  await expect(page.locator('.studio-focus-dim')).toHaveCount(0);
});

test('typewriter scroll keeps the caret line near the middle while typing', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Covered by the phone keyboard path on a device.');
  await setup(page);
  await openNote(page);

  await page.getByRole('button', { name: 'Page style' }).click();
  await page.getByRole('switch', { name: 'Typewriter scroll' }).check();
  await page.keyboard.press('Escape');

  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await editor.locator('p', { hasText: 'Line 1 of' }).click();
  await page.keyboard.press('Control+End');
  for (let line = 0; line < 3; line += 1) {
    await page.keyboard.press('Enter');
    await page.keyboard.type('Writing along the middle of the page.');
  }

  const offset = async () =>
    page.evaluate(() => {
      const pane = document.querySelector('.studio-rich-scroll')!;
      const selection = window.getSelection()!;
      const caret = selection.getRangeAt(0).getBoundingClientRect();
      const box = pane.getBoundingClientRect();
      return caret.top + caret.height / 2 - (box.top + box.height / 2);
    });
  await expect.poll(async () => Math.abs(await offset())).toBeLessThan(6);

  // Taking the wheel is the reader's call: typing resumes the follow, a
  // click or a wheel tick does not drag the page back by itself.
  await page.mouse.wheel(0, -600);
  const scrolled = await page.evaluate(
    () => document.querySelector('.studio-rich-scroll')!.scrollTop,
  );
  await page.waitForTimeout(300);
  const scrollTop = () =>
    page.evaluate(
      () => document.querySelector('.studio-rich-scroll')!.scrollTop,
    );
  expect(await scrollTop()).toBe(scrolled);
  // Neither does a click: the caret goes where it was pointed, and the page stays.
  const box = (await editor.boundingBox())!;
  await page.mouse.click(box.x + 80, 300);
  await page.waitForTimeout(300);
  expect(await scrollTop()).toBe(scrolled);
});

test('phone: the Aa popover carries focus mode, and a tap at the top wakes the bar', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Phone layout only.');
  await setup(page);
  await openNote(page);

  await page.getByRole('button', { name: 'Page style' }).click();
  // Choosing it closes the popover, so there is no checked state to wait for.
  await page.getByRole('switch', { name: 'Focus mode' }).click();
  await expect(root(page)).toHaveAttribute('data-studio-focus', 'on');
  await expect(page.locator('.studio-bar')).toHaveCSS('opacity', '0');

  await page.touchscreen.tap(200, 20);
  await expect(page.locator('.studio-bar')).toHaveCSS('opacity', '1');
});
