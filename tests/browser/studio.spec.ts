import { test, expect, type Page } from '@playwright/test';

const seed =
  '# A quieter kind of workspace\n\nA place for **unfinished ideas**, small discoveries, and things worth keeping.\n\n## On the desk\n\n- [ ] Make something useful\n- [x] Leave room to explore\n\n> Pay attention. The good ideas are usually hiding in the ordinary.\n\n## Field notes\n\nKeep following the thread.\n';

async function setup(page: Page) {
  const entries = [
    'welcome',
    'small-discoveries',
    'reading-list',
    'weekend-projects',
  ].map((id, index) => ({
    id,
    title: [
      'A quieter kind of workspace',
      'Small discoveries',
      'Reading list',
      'Weekend projects',
    ][index],
    folder: '',
    path: `${id}.md`,
    href: `/notes/${id}`,
    revision: 'r1',
    fields: {},
    body: index ? `# ${id}\n\nA fresh page.` : seed,
  }));
  const folders = [
    {
      id: 'projects',
      name: 'projects',
      parentId: null,
      depth: 0,
      noteCount: 0,
      totalNoteCount: 0,
    },
  ];
  let saved = seed;
  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const collection = {
      id: 'notes',
      label: 'Notes',
      singularLabel: 'Note',
      body: true,
      count: entries.length,
    };
    if (path.endsWith('/collections'))
      return route.fulfill({ json: { collections: [collection] } });
    if (path.includes('social-card'))
      return route.fulfill({ json: { cards: [] } });
    if (path.endsWith('/notes') && request.method() === 'GET')
      return route.fulfill({ json: { collection, entries, folders } });
    if (path.endsWith('/notes') && request.method() === 'POST') {
      const data = request.postDataJSON();
      const entry = {
        ...entries[0]!,
        id: data.slug,
        title: data.slug,
        path: `${data.slug}.md`,
        body: data.body ?? '',
        revision: 'new',
      };
      entries.push(entry);
      return route.fulfill({
        json: { entry, result: { revision: 'new', message: 'Created' } },
      });
    }
    if (path.endsWith('/move')) {
      const data = request.postDataJSON();
      const entry = entries.find((item) => item.id === data.id)!;
      if (data.nextId) entry.id = data.nextId;
      entry.folder = data.folder;
      entry.path = [entry.folder, `${entry.id}.md`].filter(Boolean).join('/');
      entry.revision += 'm';
      return route.fulfill({ json: { entry } });
    }
    const id = decodeURIComponent(path.split('/').at(-1)!);
    const entry = entries.find((item) => item.id === id);
    if (entry && request.method() === 'DELETE') {
      entries.splice(entries.indexOf(entry), 1);
      return route.fulfill({ json: { result: { message: 'Deleted' } } });
    }
    if (entry && request.method() === 'PUT') {
      const data = request.postDataJSON();
      saved = data.body;
      entry.body = saved;
      entry.revision += 'n';
      return route.fulfill({
        json: { entry, result: { revision: entry.revision, message: 'Saved' } },
      });
    }
    if (entry) return route.fulfill({ json: { collection, entry } });
    return route.fulfill({ json: { collections: [collection] } });
  });
  await page.goto('/tests/browser/');
  await expect(page.getByText('No file open', { exact: true })).toBeVisible();
  return { saved: () => saved, entries: () => entries };
}

async function openNote(page: Page) {
  const desktopFile = page.locator('[data-tree-key="entry:welcome"]');
  if (await desktopFile.isVisible()) await desktopFile.click();
  else
    await page
      .locator('.studio-mfiles__open')
      .filter({ hasText: 'welcome' })
      .click();
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toBeVisible();
}

test('continuous typing, slash blocks, formatting, undo and Markdown round trip', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page);
  await openNote(page);
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await editor.locator('h1').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type(' today');
  await expect(editor.locator('h1')).toHaveText(
    'A quieter kind of workspace today',
  );
  await expect(editor.locator('strong')).toHaveText('unfinished ideas');
  await editor.locator('p').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/heading');
  await expect(
    page.getByRole('listbox', { name: 'Insert a block' }),
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('A new direction');
  await expect(editor.locator('h1').last()).toHaveText('A new direction');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Keep going');
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await page.keyboard.press('Control+b');
  await expect(editor.locator('strong').last()).toHaveText('going');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /Keep \*\*going\*\*/,
  );
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(editor.locator('strong').last()).toHaveText('going');
  await editor.click();
  await page.keyboard.press('Control+z');
  await expect(editor.locator('strong')).toHaveCount(1);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/studio-${info.project.name}.png`,
    fullPage: true,
  });
});

test('browsing, searching, creation and responsive layout', async ({
  page,
}, info) => {
  await setup(page);
  const search = page.getByRole('searchbox');
  await search.fill('reading');
  await expect(
    page.getByText('reading list', { exact: true }).first(),
  ).toBeVisible();
  await search.fill('no-such-note');
  await expect(
    page.getByText(/No .*match|Nothing found|No results/i).first(),
  ).toBeVisible();
  await search.fill('');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: `test-results/library-${info.project.name}.png`,
    fullPage: true,
  });
});

test('tasks, note links, block movement and autosave', async ({ page }) => {
  const store = await setup(page);
  await openNote(page);
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const task = page.getByRole('checkbox', {
    name: 'Task item checkbox for Make something useful',
  });
  await task.check();
  await expect(task).toBeChecked();
  await expect.poll(store.saved).toContain('- [x] Make something useful');
  await expect(editor.locator('li').first()).toHaveCSS('display', 'flex');
  await editor.locator('p').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[reading');
  await expect(page.getByRole('listbox', { name: /note/i })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(editor.locator('.studio-wiki-chip')).toHaveText('Reading list');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(editor.locator('p').last()).toHaveText(
    'Keep following the thread.',
  );
  await expect.poll(store.saved).toContain('[[reading-list|Reading list]]');
  await editor.locator('p').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[future-note]]');
  await expect(editor.locator('.studio-wiki-chip').last()).toHaveText(
    'future-note',
  );

  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /\[\[reading-list\|Reading list\]\]/,
  );
});

test('create, rename and move a file without losing the open document', async ({
  page,
}, info) => {
  const store = await setup(page);
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Create in Notes' }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Fresh thought');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page
      .getByRole('button', { name: 'Actions for fresh thought' })
      .click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'New name', exact: true })
      .fill('Better thought');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page
      .getByRole('button', { name: 'Actions for better thought' })
      .click();
    await page.getByRole('button', { name: 'Move to…', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Move to', exact: true })
      .getByRole('button', { name: 'projects', exact: true })
      .click();
    await expect
      .poll(
        () =>
          store.entries().find((entry) => entry.id === 'better-thought')
            ?.folder,
      )
      .toBe('projects');
    return;
  }
  await page
    .getByRole('button', { name: 'New note', exact: true })
    .first()
    .click();
  const name = page.getByRole('textbox', { name: 'New entry name' });
  await name.fill('Fresh thought');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toContainText('fresh thought');
  const row = page.locator('[data-tree-key="entry:fresh-thought"]');
  await row.focus();
  await page.keyboard.press('F2');
  const rename = page.getByRole('textbox', { name: 'Rename fresh thought' });
  await rename.fill('Better thought');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  const renamed = page.locator('[data-tree-key="entry:better-thought"]');
  await expect(renamed).toBeVisible();
  await renamed.click({ button: 'right' });
  await page
    .getByRole('menu')
    .getByRole('button', { name: 'Move to…', exact: true })
    .click();
  await page.getByRole('button', { name: 'Move better thought to' }).click();
  await page.getByRole('option', { name: 'projects', exact: true }).click();
  await expect
    .poll(
      () =>
        store.entries().find((entry) => entry.id === 'better-thought')?.folder,
    )
    .toBe('projects');
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toContainText('fresh thought');
});

test('custom source, links, and block drag preserve content', async ({
  page,
}, info) => {
  await setup(page);
  await openNote(page);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill(
      '# Test page\n\nAlpha paragraph.\n\nBeta paragraph.\n\n<div style="text-align:center">Custom content</div>',
    );
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await page.getByRole('button', { name: 'Edit source', exact: true }).click();
  const custom = page.getByRole('textbox', { name: 'Custom Markdown source' });
  await custom.fill('<div style="text-align:center">Better content</div>');
  await page
    .getByRole('button', { name: 'Apply changes', exact: true })
    .click();
  await expect(editor.locator('.studio-source-block')).toContainText(
    'Better content',
  );
  await editor.locator('p').first().click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+ArrowDown');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toMatch(/^Alpha/);
  await page.keyboard.press('Control+k');
  await page
    .getByRole('textbox', { name: 'Link destination' })
    .fill('https://example.com');
  await page.getByRole('button', { name: 'Apply link', exact: true }).click();
  await expect(editor.locator('a')).toHaveAttribute(
    'href',
    'https://example.com',
  );
  if (info.project.name === 'desktop') {
    await editor.locator('p').first().hover();
    await page
      .getByRole('button', { name: 'Block actions', exact: true })
      .dragTo(editor.locator('h1'), { targetPosition: { x: 20, y: 2 } });
    await expect(editor.locator(':scope > :first-child')).toContainText(
      'Alpha paragraph.',
    );
  }
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /<div style="text-align:center">Better content<\/div>/,
  );
});

test('delete requires confirmation and removes the selected file', async ({
  page,
}) => {
  const store = await setup(page);
  await page.getByRole('searchbox').fill('reading');
  await page.getByRole('button', { name: 'Actions for reading list' }).click();
  await page.getByRole('button', { name: /^Delete(?: Del)?$/ }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete note' });
  await expect(dialog).toBeVisible();
  expect(store.entries().some((entry) => entry.id === 'reading-list')).toBe(
    true,
  );
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect
    .poll(() => store.entries().some((entry) => entry.id === 'reading-list'))
    .toBe(false);
  await expect(dialog).not.toBeVisible();
});

test('Visual uses published prose typography and Markdown stays readable', async ({
  page,
}, info) => {
  await setup(page);
  await openNote(page);
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  // Compare against the actual shared public stylesheet outside the admin shell.
  const differences = await editor.evaluate((node) => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument!;
    for (const sheet of document.querySelectorAll(
      'style, link[rel="stylesheet"]',
    ))
      doc.head.append(sheet.cloneNode(true));
    doc.body.innerHTML =
      '<article class="prose">' + node.innerHTML + '</article>';
    const actual = doc.querySelector('.prose')!;
    // Same viewport-dependent font values without needing a live note route.
    frame.style.cssText = `position:fixed;border:0;width:${innerWidth}px;height:1000px;visibility:hidden`;
    const properties = [
      'color',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'margin-top',
      'margin-bottom',
    ];
    const results: string[] = [];
    for (const selector of ['h1', 'h2', 'p', 'strong', 'blockquote']) {
      const a = getComputedStyle(node.querySelector(selector)!);
      const b = frame.contentWindow!.getComputedStyle(
        actual.querySelector(selector)!,
      );
      for (const property of properties)
        if (a.getPropertyValue(property) !== b.getPropertyValue(property))
          results.push(
            `${selector} ${property}: ${a.getPropertyValue(property)} != ${b.getPropertyValue(property)}`,
          );
    }
    frame.remove();
    return results;
  });
  expect(differences).toEqual([]);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveCSS(
    'font-size',
    '17px',
  );
  await page.screenshot({
    path: `test-results/markdown-${info.project.name}.png`,
  });
});

test('editor controls preserve settings and keyboard focus', async ({
  page,
}, info) => {
  await setup(page);
  await openNote(page);
  const options = page.getByRole('button', { name: 'Editor options' });
  await options.click();
  const autosave = page.getByRole('switch', { name: 'Autosave' });
  await expect(autosave).toHaveAttribute('aria-checked', 'true');
  await autosave.click();
  await expect(autosave).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('switch', { name: 'Focus mode' }).click();
  await expect(page.locator('.studio-surface')).toHaveClass(/is-focused/);
  await page.screenshot({
    path: `test-results/controls-${info.project.name}.png`,
  });
  await page.keyboard.press('Escape');
  await expect(options).toBeFocused();
  await expect(options).toHaveAttribute('aria-expanded', 'false');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Manual change.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.studio-save')).toHaveAttribute(
    'data-tone',
    'saved',
  );
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await expect(
    page.getByRole('link', { name: 'Admin', exact: true }),
  ).toHaveAttribute('href', '/admin');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await editor.click();
  await expect(
    page.getByRole('button', { name: 'Workspace menu' }),
  ).toHaveAttribute('aria-expanded', 'false');
});
