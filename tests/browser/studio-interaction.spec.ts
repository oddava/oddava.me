import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';

// Where the editor's features meet: one Escape closing one thing, shortcuts
// that work from anywhere on the page, the #tag menu leaving Enter alone,
// footnotes reachable by keyboard and by finger, and a picker that survives
// the page moving under it.

const seed = [
  '# Meeting note',
  'Opening words with a needle in them.',
  '## First section',
  'Another needle sits here.',
  'Tag line',
  'Claim[^1] made here.',
  '```js',
  'const answer = 42;',
  '```',
  '## Second section',
  'A last needle at the end.',
  '[^1]: The source of the claim.',
].join('\n\n');

interface Options {
  /** Every save is refused as stale, as if the note changed elsewhere. */
  conflict?: boolean;
}

async function setup(page: Page, options: Options = {}) {
  const entry = {
    id: 'meeting',
    title: 'Meeting note',
    folder: '',
    path: 'meeting.md',
    href: '/notes/meeting',
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
    if (path.endsWith('/connections'))
      return route.fulfill({
        json: {
          connections: { id: 'meeting', backlinks: [], outbound: [] },
          tags: [
            { tag: '2012', count: 7 },
            { tag: 'design-systems', count: 9 },
            { tag: 'design', count: 2 },
          ],
        },
      });
    if (path.endsWith('/notes'))
      return route.fulfill({
        json: { collection, entries: [entry], folders: [] },
      });
    if (request.method() === 'PUT') {
      const data = request.postDataJSON();
      saves.push(data.body);
      if (options.conflict)
        return route.fulfill({
          status: 409,
          json: { error: 'The note changed.', code: 'revision_conflict' },
        });
      entry.body = data.body;
      entry.revision += 'n';
      return route.fulfill({
        json: { entry, result: { revision: entry.revision, message: 'Saved' } },
      });
    }
    if (options.conflict && saves.length)
      return route.fulfill({
        json: {
          collection,
          entry: {
            ...entry,
            revision: 'r9',
            body: '# Meeting note\n\nTheirs.',
          },
        },
      });
    return route.fulfill({ json: { collection, entry } });
  });
  await page.goto('/tests/browser/');
  const desktopFile = page.locator('[data-tree-key="entry:meeting"]');
  const mobileFile = page
    .locator('.studio-mfiles__open')
    .filter({ hasText: 'meeting' });
  await expect(desktopFile.or(mobileFile)).toBeVisible();
  if (await desktopFile.isVisible()) await desktopFile.click();
  else await mobileFile.click();
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await expect(editor).toBeVisible();
  return { editor, saves };
}

/**
 * What the editor's own state holds: the selected text, and the text of the
 * block the caret is in. A click or a keystroke moves the DOM selection at
 * once, but ProseMirror learns of it on the next `selectionchange`, so a
 * chord pressed sooner acts on the selection before it. Nobody types that
 * fast; a loaded runner does. Tiptap keeps its editor on the element.
 */
const editorSelection = (editor: Locator) =>
  editor.evaluate((node) => {
    const { state } = (node as HTMLElement & { editor: Editor }).editor;
    const { from, to, $from } = state.selection;
    return {
      text: state.doc.textBetween(from, to),
      block: $from.parent.textContent,
    };
  });

const root = (page: Page) => page.locator('html');
const findBar = (page: Page) =>
  page.getByRole('search', { name: 'Find in note' });
const outline = (page: Page) => page.getByRole('dialog', { name: 'Outline' });

test('one Escape closes find, the next leaves focus mode', async ({ page }) => {
  const { editor } = await setup(page);
  await editor.getByText('Opening words').click();
  await page.keyboard.press('Control+Shift+F');
  await expect(root(page)).toHaveAttribute('data-studio-focus', 'on');

  await page.keyboard.press('Control+f');
  await findBar(page)
    .getByRole('textbox', { name: 'Find in note' })
    .fill('needle');
  // Its case toggle is not the page-style "Aa": each has a name of its own.
  await expect(
    findBar(page).getByRole('button', { name: 'Match case' }),
  ).toHaveCount(1);
  await expect(
    findBar(page).getByRole('button', { name: 'Page style' }),
  ).toHaveCount(0);

  // The caret back in the words, the bar still open.
  await editor.getByText('Another needle').click();
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(findBar(page)).toHaveCount(0);
  await expect(root(page)).toHaveAttribute('data-studio-focus', 'on');

  await page.keyboard.press('Escape');
  await expect(root(page)).not.toHaveAttribute('data-studio-focus', 'on');
});

test('one Escape closes the outline, the next leaves focus mode', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'A phone outline covers the page and closes on a jump.');
  const { editor } = await setup(page);
  await editor.getByText('Opening words').click();
  await page.keyboard.press('Control+Shift+F');
  await page.keyboard.press('Control+Shift+O');
  await expect(outline(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(outline(page)).toHaveCount(0);
  await expect(root(page)).toHaveAttribute('data-studio-focus', 'on');
  await expect(editor).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(root(page)).not.toHaveAttribute('data-studio-focus', 'on');
});

test('find, outline and focus answer from anywhere on the page, but not under a dialog', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The phone has no sidebar beside the note.');
  await setup(page);
  // Focus on the sidebar, nowhere near the editor.
  await page.locator('[data-tree-key="entry:meeting"]').focus();

  await page.keyboard.press('Control+Shift+O');
  await expect(outline(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(outline(page)).toHaveCount(0);

  // The body, as a closed dialog leaves it.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Control+f');
  const box = findBar(page).getByRole('textbox', { name: 'Find in note' });
  await expect(box).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(findBar(page)).toHaveCount(0);

  // Ctrl+G with find closed opens it rather than the browser's.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Control+g');
  await expect(box).toBeFocused();
  await page.keyboard.press('Escape');

  // The palette holds the page: find, the outline and focus mode stand down,
  // and Escape closes the palette alone.
  await page.keyboard.press('Control+p');
  const palette = page.getByRole('dialog', { name: 'Find a note or command' });
  await expect(palette).toBeVisible();
  // Ctrl+F is left to the browser there (it can search the dialog's text).
  const prevented = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await page.keyboard.press('Control+Shift+O');
  await page.keyboard.press('Control+Shift+F');
  await expect(findBar(page)).toHaveCount(0);
  await expect(outline(page)).toHaveCount(0);
  await expect(root(page)).not.toHaveAttribute('data-studio-focus', 'on');
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
});

test('closing find leaves the caret on the match it found', async ({
  page,
}) => {
  const { editor } = await setup(page);
  await editor.getByText('Opening words').click();
  await page.keyboard.press('Control+f');
  const box = findBar(page).getByRole('textbox', { name: 'Find in note' });
  await box.fill('needle');
  await box.press('Enter');
  await expect(findBar(page).getByRole('status')).toHaveText(/^\d of 3$/);
  await box.press('Escape');
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    'needle',
  );
  // Typing replaces the match: the caret is where find left it.
  await page.keyboard.type('pin');
  await expect(editor).toContainText(' pin ');
});

test('the #tag menu leaves Enter to the newline', async ({ page }) => {
  const { editor } = await setup(page);
  const line = editor.locator('p', { hasText: 'Tag line' });
  await line.click();
  await page.keyboard.press('End');

  // A number is not a tag: no menu, and Enter ends the line.
  await page.keyboard.type(' fixed in #12');
  await expect(page.getByRole('listbox', { name: 'Add a tag' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(line).toHaveText('Tag line fixed in #12');

  // A tag typed in full stays as typed, even with a busier one offered.
  await page.keyboard.type('Then #design');
  const menu = page.getByRole('listbox', { name: 'Add a tag' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toContainText('#design');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(editor.locator('p', { hasText: 'Then #' })).toHaveText(
    'Then #design',
  );
  await page.keyboard.type('Next line');
  await expect(editor.locator('p', { hasText: 'Next line' })).toHaveText(
    'Next line',
  );

  // Tab takes the top row; the arrows pick, and then Enter takes the pick.
  await page.keyboard.type(' #desi');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(editor.locator('p', { hasText: 'Next line' })).toHaveText(
    /^Next line #design(-systems)? $/,
  );
});

test('Ctrl+Shift+X strikes through, Ctrl+Shift+S does not save', async ({
  page,
}) => {
  const { editor, saves } = await setup(page);
  const line = 'Opening words with a needle in them.';
  await editor.getByText('Opening words').click();
  // The click's caret has to land before the line is selected, or it lands
  // after and collapses the selection again.
  await expect
    .poll(async () => (await editorSelection(editor)).block)
    .toBe(line);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect
    .poll(async () => (await editorSelection(editor)).text)
    .toBe(line);
  const unsaved = saves.length;
  await page.keyboard.press('Control+Shift+X');
  await expect(editor.locator('s')).toHaveText(line);
  // The strike saves on its own; only once that save has come and gone can
  // a save after the next chord be blamed on the chord.
  await expect.poll(() => saves.length).toBeGreaterThan(unsaved);
  await expect(page.locator('.studio-save')).toHaveAttribute(
    'data-tone',
    'saved',
  );
  const before = saves.length;
  await page.keyboard.press('Control+Shift+S');
  await page.waitForTimeout(300);
  expect(saves.length).toBe(before);
});

test('a paused save is said aloud and stays visible in focus mode', async ({
  page,
}) => {
  const { editor } = await setup(page, { conflict: true });
  await editor.getByText('Opening words').click();
  await page.keyboard.press('Control+Shift+F');
  await page.keyboard.type(' More.');
  const save = page.locator('.studio-save[data-tone="paused"]');
  await expect(save).toBeVisible();
  await expect(
    page.getByRole('status').filter({
      hasText: 'Saving paused — this note changed elsewhere',
    }),
  ).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator('.studio-bar')
        .evaluate((bar) => getComputedStyle(bar).opacity),
    )
    .toBe('1');
  // The strip's own news arrives in a live region that was already there.
  await expect(
    page.getByRole('status').filter({ hasText: 'Saving is paused' }),
  ).toHaveCount(1);
});

test('the keyboard goes back from a footnote to where it is used', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The phone path is the tap test below.');
  const { editor } = await setup(page);
  const reference = editor.locator('[data-footnote-ref]');
  const inFootnote = () =>
    expect
      .poll(async () => (await editorSelection(editor)).block)
      .toBe('The source of the claim.');
  await editor.getByText('The source of the claim.').click();
  await inFootnote();
  await page.keyboard.press('Escape');
  await expect(reference).toHaveClass(/ProseMirror-selectednode/);

  await editor.getByText('The source of the claim.').click();
  await inFootnote();
  await page.keyboard.press('Control+Enter');
  await expect(reference).toHaveClass(/ProseMirror-selectednode/);
  await expect(editor.getByText('The source of the claim.')).toBeVisible();
});

test('phone: a first tap selects a footnote reference, the second follows it', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'A mouse follows at once.');
  const { editor } = await setup(page);
  const reference = editor.locator('[data-footnote-ref]');
  await reference.tap();
  await expect(reference).toHaveClass(/ProseMirror-selectednode/);
  const inFootnote = () =>
    page.evaluate(
      () =>
        !!window
          .getSelection()
          ?.anchorNode?.parentElement?.closest('.studio-footnote'),
    );
  expect(await inFootnote()).toBe(false);
  // Apart, so the second is a single tap of its own rather than a double.
  await page.waitForTimeout(600);
  await reference.tap();
  await expect.poll(inFootnote).toBe(true);
});

test('the language picker survives the page moving as it opens', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Wheel scrolling is the desktop half of this.');
  await setup(page);
  await page.getByRole('button', { name: /Code language/ }).click();
  const picker = page.getByRole('dialog', { name: 'Code language' });
  await expect(picker).toBeVisible();
  // What a phone keyboard does: the viewport resizes, the page scrolls.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    const pane = document.querySelector('.studio-rich-scroll')!;
    pane.scrollTop += 40;
    pane.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    document
      .querySelector('.studio-rich-scroll')!
      .dispatchEvent(new Event('scroll'));
  });
  await expect(picker).toBeVisible();
  await expect(
    picker.getByRole('combobox', { name: 'Search code language' }),
  ).toBeFocused();

  // The writer scrolling the page is a reason to put it away: a wheel turn
  // over the note, and the scroll it makes (the note is too short to scroll,
  // so the scroll is stood in for).
  await page.evaluate(() => {
    const pane = document.querySelector('.studio-rich-scroll')!;
    pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 200 }));
    pane.dispatchEvent(new Event('scroll'));
  });
  await expect(picker).toHaveCount(0);
});
