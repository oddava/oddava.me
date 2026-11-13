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
  const group = page.getByRole('group', {
    name: 'Who can read this note',
  });
  const draft = group.getByRole('button', { name: 'Draft', exact: true });
  const published = group.getByRole('button', {
    name: 'Published',
    exact: true,
  });
  await expect(draft).toHaveAttribute('aria-pressed', 'true');
  // The desktop bar says who can see a draft, not only the phone sheet.
  await expect(draft).toHaveAttribute('title', 'Only you can see drafts.');

  await published.click();
  await expect(published).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.studio-toast')).toContainText('Published!');
  await expect(draftRow.getByText('draft', { exact: true })).toHaveCount(0);
  // Publishing writes at once and leaves no `draft` key behind.
  await expect
    .poll(() => store.writes().at(-1))
    .toEqual({ saved: 'half-written', fields: {} });

  // The arrow keys only move focus — publishing is consequential, so nothing
  // changes until Space or Enter — and they stop at either end.
  const writesBefore = store.writes().length;
  await published.focus();
  await page.keyboard.press('ArrowRight');
  await expect(published).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(draft).toBeFocused();
  await expect(published).toHaveAttribute('aria-pressed', 'true');
  await expect(draft).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);
  expect(store.writes()).toHaveLength(writesBefore);

  await page.keyboard.press('Space');
  await expect(draft).toHaveAttribute('aria-pressed', 'true');
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
    page.getByRole('button', { name: 'Draft', exact: true, pressed: true }),
  ).toBeVisible();
  // The first note Studio makes says why it is a draft — once.
  await expect(page.locator('.studio-toast')).toContainText(
    'New notes start as drafts',
  );
  await expect(page.locator('.studio-toast')).toHaveCount(0, {
    timeout: 5_000,
  });
  await page.keyboard.press('Control+p');
  await page.getByRole('option', { name: /^New note/ }).click();
  await expect
    .poll(() => store.writes().filter((write) => 'created' in write).length)
    .toBe(2);
  // The notice would follow the note opening; give it the chance, then
  // make sure it stayed quiet.
  await page.waitForTimeout(500);
  await expect(page.getByText('New notes start as drafts')).toHaveCount(0);
});

test('the phone note actions sheet carries the visibility control', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile', 'the pill lives in the bar');
  const store = await setup(page);
  await openNote(page, 'half-written');
  await expect(page.locator('.studio-bar .studio-draft-mark')).toBeVisible();

  await page.getByRole('button', { name: 'Note actions', exact: true }).click();
  await page.getByRole('button', { name: 'Published', exact: true }).click();
  await expect
    .poll(() => store.writes().at(-1))
    .toEqual({ saved: 'half-written', fields: {} });
  await expect(page.locator('.studio-bar .studio-draft-mark')).toHaveCount(0);
});
