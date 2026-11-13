import { test, expect, type Page } from '@playwright/test';

// A one-note store that another writer can change underneath Studio.
async function setup(page: Page) {
  const store = {
    revision: 'r1',
    body: '# Shared note\n\nFirst draft.\n',
    deleted: false,
    puts: [] as Array<{ revision: string; body: string }>,
  };
  const collection = {
    id: 'notes',
    label: 'Notes',
    singularLabel: 'Note',
    body: true,
    count: 1,
  };
  const entry = () => ({
    id: 'shared',
    title: 'Shared note',
    folder: '',
    path: 'shared.md',
    href: '/notes/shared',
    revision: store.revision,
    fields: {},
    body: store.body,
  });
  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/collections'))
      return route.fulfill({ json: { collections: [collection] } });
    if (path.includes('social-card'))
      return route.fulfill({ json: { cards: [] } });
    if (path.endsWith('/notes') && request.method() === 'GET')
      return route.fulfill({
        json: {
          collection,
          entries: store.deleted ? [] : [entry()],
          folders: [],
        },
      });
    if (!path.endsWith('/shared')) return route.fulfill({ json: {} });
    if (store.deleted)
      return route.fulfill({
        status: 404,
        json: { error: 'Content entry was not found.', code: 'not_found' },
      });
    if (request.method() === 'PUT') {
      const data = request.postDataJSON();
      store.puts.push({ revision: data.revision, body: data.body });
      if (data.revision !== store.revision) {
        return route.fulfill({
          status: 409,
          json: { error: 'The note changed.', code: 'revision_conflict' },
        });
      }
      store.body = data.body;
      store.revision = `r${Number(store.revision.slice(1)) + 1}`;
      return route.fulfill({
        json: {
          entry: entry(),
          result: { revision: store.revision, message: 'Saved' },
        },
      });
    }
    return route.fulfill({ json: { collection, entry: entry() } });
  });
  await page.goto('/tests/browser/');
  const desktop = page.locator('[data-tree-key="entry:shared"]');
  const phone = page
    .locator('.studio-mfiles__open')
    .filter({ hasText: 'shared' });
  await expect(desktop.or(phone)).toBeVisible();
  if (await desktop.isVisible()) await desktop.click();
  else await phone.click();
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toBeVisible();
  return store;
}

const editor = (page: Page) =>
  page.getByRole('textbox', { name: 'Note editor' });
const banner = (page: Page) => page.locator('.studio-conflict');
const revalidate = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new Event('focus')));

async function typeAtEnd(page: Page, text: string) {
  await editor(page).focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

test('a stale save pauses autosave and offers both versions', async ({
  page,
}) => {
  const store = await setup(page);
  store.revision = 'r2';
  store.body = '# Shared note\n\nTheir draft.\n';

  await typeAtEnd(page, ' Mine.');
  await expect(banner(page)).toContainText(
    'Someone edited this note elsewhere',
  );
  await expect(page.locator('.studio-save')).toHaveAttribute(
    'data-tone',
    'paused',
  );

  // Paused means paused: more typing must not reach the store.
  const attempts = store.puts.length;
  await page.keyboard.type(' More.');
  await page.waitForTimeout(1200);
  expect(store.puts.length).toBe(attempts);

  await banner(page).getByRole('button', { name: 'See what changed' }).click();
  const dialog = page.getByRole('dialog', { name: 'What changed' });
  await expect(dialog).toContainText('Their draft.');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await banner(page)
    .getByRole('button', { name: 'Load their version' })
    .click();
  await expect(editor(page)).toContainText('Their draft.');
  await expect(banner(page)).toContainText('Their version is open');

  await banner(page).getByRole('button', { name: 'Put mine back' }).click();
  await expect(editor(page)).toContainText('Mine.');
  await expect(page.locator('.studio-save')).toHaveAttribute(
    'data-tone',
    'saved',
  );
  expect(store.body).toContain('Mine.');
});

test('keeping mine overwrites with the newer revision', async ({ page }) => {
  const store = await setup(page);
  store.revision = 'r2';
  store.body = '# Shared note\n\nTheir draft.\n';

  await typeAtEnd(page, ' Mine.');
  await banner(page)
    .getByRole('button', { name: 'Keep mine (overwrite)' })
    .click();
  await expect(banner(page)).toHaveCount(0);
  await expect(page.locator('.studio-save')).toHaveAttribute(
    'data-tone',
    'saved',
  );
  expect(store.body).toContain('Mine.');
  expect(store.puts.at(-1)?.revision).toBe('r2');
});

test('a note edited elsewhere refreshes quietly when nothing is unsaved', async ({
  page,
}) => {
  const store = await setup(page);
  store.revision = 'r2';
  store.body = '# Shared note\n\nWritten in Obsidian.\n';

  await revalidate(page);
  await expect(editor(page)).toContainText('Written in Obsidian.');
  await expect(banner(page)).toHaveCount(0);
  await expect(page.locator('.studio-toast')).toContainText(
    'this note changed elsewhere',
  );
});

test('a note deleted elsewhere keeps the text and says so kindly', async ({
  page,
}) => {
  const store = await setup(page);
  await typeAtEnd(page, ' Unsaved words.');
  store.deleted = true;
  await revalidate(page);

  await expect(banner(page)).toContainText(
    'This note was moved or deleted elsewhere',
  );
  await expect(editor(page)).toContainText('Unsaved words.');
  await expect(page.locator('.studio-save')).toHaveAttribute(
    'data-tone',
    'paused',
  );
});

test('a newer version waits for an author who is typing, even when all is saved', async ({
  page,
}) => {
  const store = await setup(page);
  await typeAtEnd(page, ' Saved words.');
  await expect(page.locator('.studio-save')).toHaveAttribute(
    'data-tone',
    'saved',
  );
  store.revision = 'r9';
  store.body = '# Shared note\n\nWritten in Obsidian.\n';

  // The caret is still in the note: no quiet swap under it.
  await expect(editor(page)).toBeFocused();
  await revalidate(page);
  await expect(banner(page)).toContainText(
    'Someone edited this note elsewhere',
  );
  await expect(banner(page)).toContainText('Everything you typed is saved');
  await expect(editor(page)).toContainText('Saved words.');

  await banner(page)
    .getByRole('button', { name: 'Load their version' })
    .click();
  await expect(editor(page)).toContainText('Written in Obsidian.');
  // What was saved is in the store's history; nothing needed setting aside.
  await expect(banner(page)).toHaveCount(0);

  // The caret was carried into the new text rather than sent to the top.
  // (Read from the editor's state: it is what the editor's own focus
  // restores, where a bare element.focus() would let the browser choose.)
  const before = await page.evaluate(() => {
    const view = (
      document.querySelector('.ProseMirror') as HTMLElement & {
        editor?: {
          state: {
            selection: { from: number };
            doc: { textBetween: (from: number, to: number) => string };
          };
        };
      }
    ).editor!.state;
    return view.doc.textBetween(0, view.selection.from);
  });
  expect(before.endsWith('Written in Obsidian.')).toBe(true);
});
