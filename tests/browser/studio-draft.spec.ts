import { test, expect, type Page } from '@playwright/test';

interface MockEntry {
  id: string;
  title: string;
  folder: string;
  path: string;
  href: string;
  revision: string;
  draft?: true;
  fields: Record<string, unknown>;
  body: string;
}

function note(id: string, draft = false): MockEntry {
  return {
    id,
    title: id,
    folder: '',
    path: `${id}.md`,
    href: `/notes/${id}`,
    revision: 'r1',
    ...(draft ? { draft: true as const } : {}),
    fields: draft ? { draft: true } : {},
    body: `# ${id}\n\nA page.`,
  };
}

// A trimmed-down store: just enough of the admin API for Studio to list, open,
// save and create notes, remembering the frontmatter each write carried.
async function setup(page: Page) {
  const entries = [note('welcome'), note('half-written', true)];
  const writes: Record<string, unknown>[] = [];
  const collection = {
    id: 'notes',
    label: 'Notes',
    singularLabel: 'Note',
    body: true,
    count: entries.length,
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
        json: { collection, entries, folders: [] },
      });
    if (path.endsWith('/notes') && request.method() === 'POST') {
      const data = request.postDataJSON();
      writes.push({ created: data.slug, fields: data.fields });
      const created = {
        ...note(data.slug),
        body: data.body ?? '',
        fields: data.fields ?? {},
        ...(data.fields?.draft ? { draft: true as const } : {}),
      };
      entries.push(created);
      return route.fulfill({
        json: { entry: created, result: { revision: 'r1', message: 'ok' } },
      });
    }
    const id = decodeURIComponent(path.split('/').at(-1)!);
    const entry = entries.find((item) => item.id === id);
    if (entry && request.method() === 'PUT') {
      const data = request.postDataJSON();
      writes.push({ saved: id, fields: data.fields });
      entry.fields = data.fields;
      if (data.fields?.draft) entry.draft = true;
      else delete entry.draft;
      entry.revision += 'n';
      return route.fulfill({
        json: { entry, result: { revision: entry.revision, message: 'ok' } },
      });
    }
    if (entry) return route.fulfill({ json: { collection, entry } });
    return route.fulfill({ json: { collections: [collection] } });
  });
  await page.goto('/tests/browser/');
  return { writes: () => writes };
}

async function openNote(page: Page, id: string) {
  const desktop = page.locator(`[data-tree-key="entry:${id}"]`);
  const phone = page.locator('.studio-mfiles__open').filter({ hasText: id });
  await expect(desktop.or(phone)).toBeVisible();
  if (await desktop.isVisible()) await desktop.click();
  else await phone.click();
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toBeVisible();
}

test('a draft is marked in the list and published from the editor bar', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'the phone uses the note sheet');
  const store = await setup(page);

  const draftRow = page.locator('[data-tree-key="entry:half-written"]');
  await expect(draftRow.getByText('draft', { exact: true })).toBeVisible();
  await expect(
    page.locator('[data-tree-key="entry:welcome"]').getByText('draft'),
  ).toHaveCount(0);

  await openNote(page, 'half-written');
  const group = page.getByRole('radiogroup', {
    name: 'Who can read this note',
  });
  const draft = group.getByRole('radio', { name: 'Draft' });
  const published = group.getByRole('radio', { name: 'Published' });
  await expect(draft).toBeChecked();

  await published.click();
  await expect(published).toBeChecked();
  await expect(page.locator('.studio-toast')).toContainText('Published!');
  await expect(draftRow.getByText('draft', { exact: true })).toHaveCount(0);
  // Publishing writes at once and leaves no `draft` key behind.
  await expect
    .poll(() => store.writes().at(-1))
    .toEqual({ saved: 'half-written', fields: {} });

  // The arrow keys move the selection, and focus goes with it.
  await published.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(draft).toBeChecked();
  await expect(draft).toBeFocused();
  await expect
    .poll(() => store.writes().at(-1))
    .toEqual({ saved: 'half-written', fields: { draft: true } });
});

test('the palette publishes the open note and new notes start as drafts', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'the phone uses the note sheet');
  const store = await setup(page);
  await openNote(page, 'welcome');

  await page.keyboard.press('Control+p');
  await page.getByRole('option', { name: /Move note to drafts/ }).click();
  await expect
    .poll(() => store.writes().at(-1))
    .toEqual({ saved: 'welcome', fields: { draft: true } });

  await page.keyboard.press('Control+p');
  await page.getByRole('option', { name: /^New note/ }).click();
  await expect
    .poll(() => store.writes().find((write) => 'created' in write))
    .toEqual({ created: 'untitled', fields: { draft: true } });
  await expect(
    page.getByRole('radio', { name: 'Draft', checked: true }),
  ).toBeVisible();
});

test('the phone note actions sheet carries the visibility control', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile', 'the pill lives in the bar');
  const store = await setup(page);
  await openNote(page, 'half-written');
  await expect(page.locator('.studio-bar .studio-draft-mark')).toBeVisible();

  await page.getByRole('button', { name: 'Note actions', exact: true }).click();
  await page.getByRole('radio', { name: 'Published' }).click();
  await expect
    .poll(() => store.writes().at(-1))
    .toEqual({ saved: 'half-written', fields: {} });
  await expect(page.locator('.studio-bar .studio-draft-mark')).toHaveCount(0);
});
