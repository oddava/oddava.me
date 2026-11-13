import { test, expect, type Page } from '@playwright/test';

// Code languages, callouts and footnotes in the real editor: what the author
// does (slash menu, chips, typing) and what is saved as Markdown.

async function setup(page: Page, body = '') {
  const entry = {
    id: 'welcome',
    title: 'Welcome',
    folder: '',
    path: 'welcome.md',
    href: '/notes/welcome',
    revision: 'r1',
    fields: {},
    body,
  };
  let saved = body;
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
    if (path.endsWith('/notes') && request.method() === 'GET')
      return route.fulfill({
        json: { collection, entries: [entry], folders: [] },
      });
    if (request.method() === 'PUT') {
      saved = request.postDataJSON().body;
      entry.body = saved;
      entry.revision += 'n';
      return route.fulfill({
        json: {
          entry,
          result: { revision: entry.revision, message: 'Saved' },
        },
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
  return {
    editor,
    saved: async () => {
      await expect(page.locator('.studio-save')).toHaveAttribute(
        'data-tone',
        'saved',
      );
      return saved;
    },
  };
}

async function slash(page: Page, command: string) {
  await page.keyboard.type(`/${command}`);
  await expect(page.locator('.studio-slashmenu')).toBeVisible();
  await page.keyboard.press('Enter');
}

test('a callout from the slash menu saves as GitHub-style Markdown and changes kind', async ({
  page,
}) => {
  const { editor, saved } = await setup(page);
  await editor.click();
  await slash(page, 'callout');
  const card = editor.locator('.callout');
  await expect(card).toHaveClass(/callout--note/);
  await page.keyboard.type('Mind the gap.');
  expect(await saved()).toBe('> [!NOTE]\n> Mind the gap.');

  const kind = card.getByRole('button', { name: /Callout kind: Note/ });
  await kind.click();
  const list = page.getByRole('listbox', { name: 'Callout kind' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('option', { name: /Note/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.screenshot({
    path: `test-results/callout-picker-${page.viewportSize()!.width}.png`,
  });
  await list.getByRole('option', { name: /Warning/ }).click();
  await expect(list).toBeHidden();
  await expect(card).toHaveClass(/callout--warning/);
  expect(await saved()).toBe('> [!WARNING]\n> Mind the gap.');
  // Choosing hands the caret back to the writing.
  await page.keyboard.type(' Really.');
  expect(await saved()).toBe('> [!WARNING]\n> Mind the gap. Really.');
});

test('every callout kind draws, in the editor and in reading order', async ({
  page,
}) => {
  const body = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']
    .map((kind) => `> [!${kind}]\n> A **${kind.toLowerCase()}** callout.`)
    .join('\n\n');
  const { editor } = await setup(page, body);
  await expect(editor.locator('.callout')).toHaveCount(5);
  await editor.locator('.callout').first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/callouts-${page.viewportSize()!.width}.png`,
  });
});

test('a code block names its language, offers a searchable list, and colours the code', async ({
  page,
}) => {
  const { editor, saved } = await setup(page, '```\nconst a = 1; // one\n```');
  const chip = editor.getByRole('button', {
    name: /Code language: Plain text/,
  });
  await expect(chip).toBeVisible();
  await expect(editor.locator('.tok-kw')).toHaveCount(0);

  await chip.click();
  const search = page.getByRole('combobox', { name: /Search code language/ });
  await expect(search).toBeFocused();
  await search.fill('typescr');
  const list = page.getByRole('listbox', { name: 'Code language' });
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toHaveText(/TypeScript/);
  await page.screenshot({
    path: `test-results/code-picker-${page.viewportSize()!.width}.png`,
  });
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();

  await expect(editor.locator('.studio-code-lang')).toHaveText('TypeScript');
  await expect(editor.locator('.tok-kw')).toHaveText('const');
  await expect(editor.locator('.tok-com')).toHaveText('// one');
  expect(await saved()).toBe('```ts\nconst a = 1; // one\n```');
  await page.screenshot({
    path: `test-results/code-block-${page.viewportSize()!.width}.png`,
  });

  // A word the list does not know can still be a language.
  await editor.locator('.studio-code-lang').click();
  await page
    .getByRole('combobox', { name: /Search code language/ })
    .fill('zig');
  await page.keyboard.press('Enter');
  await expect(editor.locator('.studio-code-lang')).toHaveText('zig');
  expect(await saved()).toBe('```zig\nconst a = 1; // one\n```');
});

test('Escape closes the picker and leaves the language alone', async ({
  page,
}) => {
  const { editor, saved } = await setup(page, '```js\nlet a\n```');
  const chip = editor.locator('.studio-code-lang');
  await chip.click();
  await expect(
    page.getByRole('listbox', { name: 'Code language' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('listbox', { name: 'Code language' }),
  ).toBeHidden();
  await expect(chip).toBeFocused();
  expect(await saved()).toBe('```js\nlet a\n```');
});

test('a footnote from the slash menu adds the reference and an empty note to write', async ({
  page,
}) => {
  const { editor, saved } = await setup(page);
  await editor.click();
  await page.keyboard.type('A claim worth sourcing.');
  await page.keyboard.press('Enter');
  await slash(page, 'footnote');
  await page.keyboard.type('Because I read it.');
  expect(await saved()).toBe(
    'A claim worth sourcing.[^1]\n\n[^1]: Because I read it.',
  );
  const reference = editor.locator('[data-footnote-ref]');
  await expect(reference).toHaveAttribute('data-footnote-number', '1');
  await expect(editor.locator('[data-footnote-definition]')).toContainText(
    'Because I read it.',
  );
  await page.screenshot({
    path: `test-results/footnote-${page.viewportSize()!.width}.png`,
  });

  // The pill leads to the note and the note leads back. A finger's first
  // tap only selects it; the second, on the selected pill, follows.
  await reference.click();
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    await expect(reference).toHaveClass(/ProseMirror-selectednode/);
    await page.waitForTimeout(600);
    await reference.click();
  }
  await page.keyboard.type('!');
  expect(await saved()).toContain('[^1]: !Because I read it.');
  await editor.locator('[data-footnote-jump]').click();
  await expect(reference).toHaveClass(/ProseMirror-selectednode/);
});

test('footnotes already in a note open as nodes, not custom blocks', async ({
  page,
}) => {
  const { editor } = await setup(
    page,
    'One[^a] two[^b].\n\n[^a]: Alpha.\n\n[^b]: Beta.',
  );
  await expect(editor.locator('[data-footnote-ref]')).toHaveCount(2);
  await expect(editor.locator('.studio-custom-block')).toHaveCount(0);
  await expect(
    editor.locator('[data-footnote-definition]').first(),
  ).toHaveAttribute('data-footnote-number', '1');
});
