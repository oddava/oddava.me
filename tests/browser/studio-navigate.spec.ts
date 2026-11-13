import { test, expect, type Page } from '@playwright/test';

// A note long enough to scroll: four sections, each a few screens of words, so
// the outline has somewhere to take you and find has more than one match.
const filler = Array.from(
  { length: 6 },
  (_, index) =>
    `Paragraph ${index + 1} wanders along for a while, collecting small thoughts about gardens, kettles and the quiet hour before the rain.`,
).join('\n\n');
const seed = [
  '# Long note',
  'Opening words with a needle in them.',
  ...['Alpha', 'Beta', 'Gamma', 'Delta'].flatMap((name) => [
    `## ${name} section`,
    filler,
    `Another needle sits at the end of ${name}.`,
  ]),
].join('\n\n');

async function setup(page: Page) {
  const entry = {
    id: 'welcome',
    title: 'Long note',
    folder: '',
    path: 'welcome.md',
    href: '/notes/welcome',
    revision: 'r1',
    fields: {},
    body: seed,
  };
  const collection = {
    id: 'notes',
    label: 'Notes',
    singularLabel: 'Note',
    body: true,
    count: 1,
  };
  const saves: string[] = [];
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
      const data = request.postDataJSON();
      saves.push(data.body);
      entry.body = data.body;
      entry.revision += 'n';
      return route.fulfill({
        json: { entry, result: { revision: entry.revision, message: 'Saved' } },
      });
    }
    return route.fulfill({ json: { collection, entry } });
  });
  await page.goto('/tests/browser/');
  const desktopFile = page.locator('[data-tree-key="entry:welcome"]');
  const mobileFile = page
    .locator('.studio-mfiles__open')
    .filter({ hasText: 'welcome' });
  await expect(desktopFile.or(mobileFile)).toBeVisible();
  if (await desktopFile.isVisible()) await desktopFile.click();
  else await mobileFile.click();
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+Home');
  return { editor, saves };
}

test('find highlights, steps and closes without touching the note', async ({
  page,
}) => {
  const { editor, saves } = await setup(page);
  await page.keyboard.press('Control+f');
  const find = page.getByRole('search', { name: 'Find in note' });
  const box = find.getByRole('textbox', { name: 'Find in note' });
  await expect(box).toBeFocused();

  await box.fill('needle');
  await expect(find.getByRole('status')).toHaveText('1 of 5');
  await expect(editor.locator('.studio-find-match')).toHaveCount(5);
  await expect(editor.locator('.studio-find-match.is-active')).toHaveCount(1);

  await box.press('Enter');
  await expect(find.getByRole('status')).toHaveText('2 of 5');
  await box.press('Shift+Enter');
  await box.press('Shift+Enter');
  await expect(find.getByRole('status')).toHaveText('5 of 5');
  // The active match is scrolled into view.
  await expect(editor.locator('.studio-find-match.is-active')).toBeInViewport();

  await find.getByRole('button', { name: 'Match case' }).click();
  await box.fill('Needle');
  await expect(find.getByRole('status')).toHaveText('No matches');

  // Esc closes, takes the highlights with it, and gives the page its caret.
  await box.press('Escape');
  await expect(find).toHaveCount(0);
  await expect(editor.locator('.studio-find-match')).toHaveCount(0);
  await expect(editor).toBeFocused();
  // Nothing was written for a search.
  await page.waitForTimeout(1200);
  expect(saves).toEqual([]);
});

test('replace all is one undo step and saves the replaced Markdown', async ({
  page,
}) => {
  const { editor, saves } = await setup(page);
  await page.keyboard.press('Control+f');
  const find = page.getByRole('search', { name: 'Find in note' });
  await find.getByRole('textbox', { name: 'Find in note' }).fill('needle');
  await find.getByRole('button', { name: 'Replace', exact: true }).click();
  await find.getByRole('textbox', { name: 'Replace with' }).fill('pebble');
  await find.getByRole('button', { name: 'All', exact: true }).click();
  await expect(find.getByRole('status')).toHaveText('Replaced 5');
  await expect(editor).toContainText('Opening words with a pebble in them.');
  await expect(editor).not.toContainText('needle');
  await expect.poll(() => saves.at(-1) ?? '').toContain('with a pebble in');

  await find.getByRole('button', { name: 'Close find' }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(editor).toContainText('Opening words with a needle in them.');
  await expect(editor).not.toContainText('pebble');
});

test('the outline lists headings, jumps, follows the scroll and closes with Esc', async ({
  page,
}) => {
  const { editor } = await setup(page);
  await page.getByRole('button', { name: 'Outline' }).click();
  const outline = page.getByRole('dialog', { name: 'Outline' });
  const items = outline.getByRole('button').filter({ hasText: 'section' });
  await expect(items).toHaveText([
    'Alpha section',
    'Beta section',
    'Gamma section',
    'Delta section',
  ]);
  // Exactly one section is marked as the one you are in.
  await expect(outline.locator('[aria-current="location"]')).toHaveCount(1);

  await items.nth(2).click();
  const heading = editor.getByRole('heading', { name: 'Gamma section' });
  await expect(heading).toBeInViewport();
  await expect(editor).toBeFocused();
  // The caret is at the start of the heading: typing lands there.
  await page.keyboard.type('!');
  await expect(heading).toHaveText('!Gamma section');

  // A phone's panel steps aside after a jump; a desktop's stays beside the
  // page, follows the edit and the scroll, and closes with Esc.
  if (page.viewportSize()!.width <= 720) {
    await expect(outline).toHaveCount(0);
    return;
  }
  await expect(outline.locator('[aria-current="location"]')).toHaveText(
    '!Gamma section',
  );
  await editor
    .getByRole('heading', { name: 'Beta section' })
    .evaluate((node) => {
      const pane = node.closest('.studio-rich-scroll')!;
      pane.scrollTop +=
        node.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8;
    });
  await expect(outline.locator('[aria-current="location"]')).toHaveText(
    'Beta section',
  );
  await expect(editor).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(outline).toHaveCount(0);
  await expect(editor).toBeFocused();
});

test('the word count follows the note and then the selection', async ({
  page,
}) => {
  const { editor } = await setup(page);
  const count = page.locator('.studio-wordcount');
  await expect(count).toContainText(/\d+ words · \d+ min/);
  await editor.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+Control+ArrowRight');
  await expect(count).toContainText(/\d+ words? selected/);
  await page.keyboard.press('ArrowLeft');
  await expect(count).toContainText(/words · /);
});
