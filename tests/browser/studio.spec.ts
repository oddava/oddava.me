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
  const mobileFile = page
    .locator('.studio-mfiles__open')
    .filter({ hasText: 'welcome' });
  await expect(desktopFile.or(mobileFile)).toBeVisible();
  if (await desktopFile.isVisible()) await desktopFile.click();
  else await mobileFile.click();
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toBeVisible();
}

async function setView(page: Page, name: 'Visual' | 'Markdown' | 'Preview') {
  // Typing hides the header; moving the pointer reveals its controls.
  await page.mouse.move(1, 1);
  await page.getByRole('button', { name, exact: true }).click();
}

test('YouTube slash command validates links and survives mode changes', async ({
  page,
}) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Video player</p>' }),
  );
  const store = await setup(page);
  await openNote(page);
  await setView(page, 'Markdown');
  await page.getByRole('combobox', { name: 'Note source' }).fill('');
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await editor.click();
  await page.keyboard.type('/youtube');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Embed YouTube video' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('YouTube link').fill('https://example.com/video');
  await dialog
    .getByRole('button', { name: 'Embed video', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog
    .getByLabel('YouTube link')
    .fill('https://youtu.be/dQw4w9WgXc?t=90');
  await dialog
    .getByRole('button', { name: 'Embed video', exact: true })
    .click();
  await expect(editor.locator('.note-youtube iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXc?start=90',
  );
  await expect.poll(store.saved).toContain('note-youtube');
  await setView(page, 'Preview');
  await expect(page.locator('.studio-preview iframe')).toHaveAttribute(
    'src',
    /start=90$/,
  );
  await setView(page, 'Markdown');
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /<iframe/,
  );
  await setView(page, 'Visual');
  await expect(editor.locator('.note-youtube iframe')).toHaveCount(1);
  await expect(editor.locator('.studio-source-block')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/youtube-embed.png' });
});

test('clearing a note does not manufacture a title in preview', async ({
  page,
}) => {
  const store = await setup(page);
  await openNote(page);
  await setView(page, 'Markdown');
  await page.getByRole('combobox', { name: 'Note source' }).fill('');
  await expect.poll(store.saved).toBe('');
  await setView(page, 'Preview');
  await expect(page.locator('.studio-preview h1')).toHaveCount(0);
  await expect(page.locator('.studio-preview__stub')).toBeVisible();
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill('# A fresh start');
  await setView(page, 'Preview');
  await expect(page.locator('.studio-preview h1')).toHaveCount(1);
  await expect(page.locator('.studio-preview h1')).toHaveText('A fresh start');
});

test('block controls follow hovered text and sidebar controls replace the header', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'Pointer hover uses the desktop layout',
  );
  await setup(page);
  await openNote(page);
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const grip = page.getByRole('button', { name: 'Block actions', exact: true });
  await page.mouse.move(0, 0);
  await expect(grip).toBeHidden();
  const paragraph = editor.locator('p').last();
  await paragraph.hover();
  await expect(grip).toBeVisible();
  const aligned = async () => {
    const block = await paragraph.boundingBox();
    const button = await grip.boundingBox();
    return Boolean(
      block && button && Math.abs(block.y - button.y) < 6 && button.x < block.x,
    );
  };
  await expect.poll(aligned).toBe(true);
  const surface = await page.locator('.studio-rich-scroll').boundingBox();
  await page.mouse.move(
    surface!.x + surface!.width / 2,
    surface!.y + surface!.height - 15,
  );
  await expect(grip).toBeHidden();
  await paragraph.hover();
  await page.keyboard.press('Control+\\');
  await expect(
    page.getByRole('button', { name: 'Show Files explorer' }),
  ).toHaveText('#');
  await expect.poll(aligned).toBe(true);
  await paragraph.hover();
  await grip.hover();
  await expect(grip).toBeVisible();
  await grip.click();
  await expect(
    page.getByRole('menu', { name: /Actions for this/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await expect(grip).toBeHidden();
  await page.getByRole('button', { name: 'Show Files explorer' }).click();
  const sidebar = page.getByRole('region', { name: 'Files explorer' });
  await sidebar.getByRole('button', { name: 'Quick open file' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio-workbench-nav')).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Close Files explorer' }).click();
  await page.getByRole('button', { name: 'Show Files explorer' }).click();
  await paragraph.hover();
  await page.screenshot({ path: 'test-results/studio-sidebar-hover.png' });
});

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
  // Wait for the editor to observe the browser's native selection change.
  await expect(
    page.getByRole('toolbar', { name: 'Formatting', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(editor.locator('strong').last()).toHaveText('going');
  await setView(page, 'Markdown');
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /Keep \*\*going\*\*/,
  );
  await setView(page, 'Visual');
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
  if (info.project.name === 'desktop') {
    const sidebar = page.getByRole('region', { name: 'Files explorer' });
    await expect(sidebar.getByRole('searchbox')).toHaveCount(0);
    await expect(sidebar.locator('.studio-explorer__heading')).toHaveText(
      'Files',
    );
    await sidebar.getByRole('button', { name: 'Quick open file' }).click();
  }
  const search =
    info.project.name === 'desktop'
      ? page.getByRole('textbox', { name: 'Go to a file or run a command' })
      : page.getByRole('searchbox');
  await search.fill('reading');
  await expect(
    info.project.name === 'desktop'
      ? page.getByRole('option').filter({ hasText: 'Reading list' })
      : page.getByText('reading list', { exact: true }).first(),
  ).toBeVisible();
  await search.fill('no-such-note');
  await expect(
    page.getByText(/No .*match|Nothing found|No results/i).first(),
  ).toBeVisible();
  await search.fill('');
  if (info.project.name === 'desktop') await page.keyboard.press('Escape');
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

  await setView(page, 'Markdown');
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
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill(
      '# Test page\n\nAlpha paragraph.\n\nBeta paragraph.\n\n<div style="text-align:center">Custom content</div>',
    );
  await setView(page, 'Visual');
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
  await setView(page, 'Markdown');
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
  await setView(page, 'Markdown');
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveCSS(
    'font-size',
    '17px',
  );
  await page.screenshot({
    path: `test-results/markdown-${info.project.name}.png`,
  });
});

test('typing hides the header and saves without settings', async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'oddava.studio.session',
      JSON.stringify({ autosave: false, focusMode: true }),
    ),
  );
  const store = await setup(page);
  await openNote(page);
  await expect(
    page.getByRole('button', { name: 'Editor options' }),
  ).toHaveCount(0);
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const header = page.locator('.studio-bar');
  await expect(header).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');
  const before = await page.locator('.studio-surface').boundingBox();
  await page.keyboard.type(' Automatic change.');
  await expect(header).toBeHidden();
  await expect(header).toHaveCSS('opacity', '0');
  const noteBackground = await page
    .locator('.studio-rich-scroll')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await expect(page.locator('.studio-editor--primary')).toHaveCSS(
    'background-color',
    noteBackground,
  );
  expect((await page.locator('.studio-surface').boundingBox())!.y).toBe(
    before!.y,
  );
  await expect.poll(store.saved).toContain('Automatic change.');
  await page.mouse.move(5, 5);
  await expect(header).toBeVisible();
  await expect(page.locator('.studio-save')).toHaveAttribute(
    'data-tone',
    'saved',
  );
  await expect(
    page.getByRole('button', { name: 'Workspace menu' }),
  ).toHaveCount(0);
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill('Source editing also saves.');
  await expect(header).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(header).toBeVisible();
  await expect.poll(store.saved).toContain('Source editing also saves.');
  await page.screenshot({
    path: `test-results/automatic-header-${info.project.name}.png`,
  });
});

test('select all stays within the current text block', async ({ page }) => {
  await setup(page);
  await openNote(page);
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  for (const block of [
    editor.locator('h1'),
    editor.locator('p').last(),
    editor.locator('li p').first(),
  ]) {
    await block.click();
    const text = await block.textContent();
    await page.keyboard.press('Control+a');
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe(text);
    await page.keyboard.press('Control+a');
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe(text);
  }
  await editor.locator('p').last().click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Only this block changes.');
  await expect(editor.locator('h1')).toHaveText('A quieter kind of workspace');
  await expect(editor.locator('p').last()).toHaveText(
    'Only this block changes.',
  );
});

test('phone typing keeps the page spacious and Files covers editor controls', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile');
  await setup(page);
  await openNote(page);
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await editor.locator('p').first().click();
  await expect(
    page.getByRole('toolbar', { name: 'Formatting' }),
  ).not.toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', {
      configurable: true,
      value: 420,
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.studio')).toHaveClass(/is-keyboard-open/);
  await expect(page.locator('.studio-dock')).not.toBeVisible();
  await expect(page.locator('.studio-workbench-nav')).not.toBeVisible();
  expect(
    await page
      .locator('.studio-rich-scroll')
      .evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThan(330);
  await page.keyboard.type(' Still writing.');
  await page.screenshot({
    path: 'test-results/phone-keyboard.png',
    clip: { x: 0, y: 0, width: 390, height: 420 },
  });
  await page.mouse.move(1, 1);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', {
      configurable: true,
      value: innerHeight,
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.studio')).not.toHaveClass(/is-keyboard-open/);
  await editor.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Show Files explorer', exact: true })
    .click();
  await expect(
    page.getByRole('toolbar', { name: 'Formatting' }),
  ).not.toBeVisible();
  await expect(page.locator('.studio-workbench')).toHaveAttribute('inert', '');
  const drawer = page.getByRole('region', { name: 'Files explorer' });
  await expect(drawer).toBeVisible();
  await page.screenshot({ path: 'test-results/phone-files.png' });
  expect(
    await drawer.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return node.contains(
        document.elementFromPoint(rect.width / 2, rect.bottom - 120),
      );
    }),
  ).toBe(true);
});

test('local images and captions render and reopen for adjustment', async ({
  page,
}, info) => {
  await setup(page);
  await page.route('**/images/test.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#6495f5"/></svg>',
    }),
  );
  await openNote(page);
  await setView(page, 'Markdown');
  const source =
    '# Images\n\n<img src="/images/test.svg" alt="Local image" style="width:50%;display:block;margin:auto">\n\n<figure style="margin:1.2em 0;text-align:left">\n  <img src="/images/test.svg" alt="Captioned image" style="width:75%">\n  <figcaption style="opacity:0.7">Original caption</figcaption>\n</figure>';
  await page.getByRole('combobox', { name: 'Note source' }).fill(source);
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await expect(editor.locator('img')).toHaveCount(2);
  await expect(editor.locator('figcaption')).toHaveText('Original caption');
  await expect(editor.locator('.studio-source-block')).toHaveCount(0);
  expect(
    await editor
      .locator('img')
      .first()
      .evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
      ),
  ).toBe(true);
  await setView(page, 'Markdown');
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    source,
  );
  await setView(page, 'Visual');
  const target = editor.getByRole('img', { name: 'Captioned image' });
  if (info.project.name === 'mobile') {
    await target.tap();
    await target.tap();
  } else await target.dblclick();
  const dialog = page.getByRole('dialog', { name: 'Edit image' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Image URL or path')).toHaveValue(
    '/images/test.svg',
  );
  await expect(dialog.getByRole('tab', { name: 'Upload' })).toHaveCount(0);
  await dialog.getByLabel('Caption (optional)').fill('Updated caption');
  await dialog.getByRole('button', { name: 'Center', exact: true }).click();
  await dialog.getByRole('slider', { name: 'Image width' }).fill('50');
  await expect(dialog.locator('img')).toHaveAttribute(
    'src',
    '/images/test.svg',
  );
  await page.screenshot({
    path: `test-results/image-dialog-${info.project.name}.png`,
  });
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(editor.locator('img')).toHaveCount(2);
  await expect(editor.locator('figcaption')).toHaveText('Updated caption');
  await expect(
    editor.getByRole('img', { name: 'Captioned image' }),
  ).toHaveClass(/note-image--width-50/);
  await setView(page, 'Markdown');
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /note-figure--align-center/,
  );
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /Updated caption/,
  );
});

test('images keep text below and clicking underneath continues writing', async ({
  page,
}, info) => {
  await setup(page);
  await page.route('**/images/block.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="140"><rect width="300" height="140" fill="#6495f5"/></svg>',
    }),
  );
  await openNote(page);
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill(
      '<img src="/images/block.svg" alt="First" class="note-image note-image--width-50 note-image--align-left">\n\n![Last](/images/block.svg)',
    );
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const selectedImage = editor.getByRole('img', { name: 'First', exact: true });
  await selectedImage.click();
  await expect(editor.locator('[data-rich-image]').first()).toHaveClass(
    /ProseMirror-selectednode/,
  );
  await expect(editor.locator('[data-rich-image]').first()).toHaveCSS(
    'outline-style',
    'none',
  );
  await expect(selectedImage).toHaveCSS('outline-style', 'solid');
  await page.screenshot({
    path: `test-results/image-selection-${info.project.name}.png`,
  });

  await editor
    .getByRole('button', { name: 'Write below image' })
    .first()
    .click();
  await page.keyboard.type('Between images');
  await expect(editor.locator('p')).toHaveText('Between images');
  const first = await editor
    .getByRole('img', { name: 'First', exact: true })
    .boundingBox();
  const paragraph = await editor.locator('p').boundingBox();
  expect(paragraph!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
  await editor
    .getByRole('button', { name: 'Write below image' })
    .last()
    .click();
  await page.keyboard.type('After the last image');
  await expect(editor.locator('p').last()).toHaveText('After the last image');
  const last = await editor
    .getByRole('img', { name: 'Last', exact: true })
    .boundingBox();
  const end = await editor.locator('p').last().boundingBox();
  expect(end!.y).toBeGreaterThanOrEqual(last!.y + last!.height);
  await editor
    .getByRole('button', { name: 'Write below image' })
    .last()
    .click();
  await expect(editor.locator('p')).toHaveCount(2);
  await page.screenshot({
    path: `test-results/image-blocks-${info.project.name}.png`,
  });
});

test('columns keep mixed content through preview and mode changes', async ({
  page,
}, info) => {
  await setup(page);
  await openNote(page);
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill(
      'Intro.\n\n:::columns equal\nLeft text\n:::column\nRight text\n:::\n\nAfter.',
    );
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await expect(editor.locator('.note-column')).toHaveCount(2);
  await expect(
    page.getByRole('toolbar', { name: 'Column actions' }),
  ).toHaveCount(0);
  await editor.getByText('Right text', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
  await page
    .getByRole('button', { name: 'Block actions', exact: true })
    .click();
  await page.getByRole('button', { name: 'Wider left', exact: true }).click();
  await expect(editor.locator('.note-columns')).toHaveClass(
    /note-columns--left/,
  );
  await setView(page, 'Markdown');
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /:::columns left[\s\S]*Right text edited/,
  );
  await setView(page, 'Preview');
  await expect(page.locator('.studio-preview .note-column')).toHaveCount(2);
  await setView(page, 'Visual');
  await editor.getByText('Right text edited', { exact: true }).click();
  await page.screenshot({
    path: `test-results/columns-${info.project.name}.png`,
  });
  await page
    .getByRole('button', { name: 'Block actions', exact: true })
    .click();
  await page.getByRole('button', { name: 'Stack', exact: true }).click();
  await expect(editor.locator('.note-columns')).toHaveCount(0);
  await expect(editor).toContainText('Right text edited');
  await page.keyboard.press('Control+z');
  await expect(editor.locator('.note-column')).toHaveCount(2);
});

test('dragging an image moves one block and preserves its size', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Native drag uses a mouse');
  await setup(page);
  await openNote(page);
  await page.route('**/images/drag.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="blue"/></svg>',
    }),
  );
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill(
      '# Start\n\nBefore.\n\n<img src="/images/drag.svg" alt="Move me" class="note-image note-image--width-50">\n\nEnd.',
    );
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const imageBox = (await editor
    .getByRole('img', { name: 'Move me' })
    .boundingBox())!;
  const headingBox = (await editor.locator('h1').boundingBox())!;
  await page.mouse.move(
    imageBox.x + imageBox.width / 2,
    imageBox.y + imageBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(headingBox.x + headingBox.width / 2, headingBox.y + 1, {
    steps: 12,
  });
  await page.mouse.move(headingBox.x + headingBox.width / 2, headingBox.y + 2);
  await expect(page.locator('.studio-rich-drop')).toBeVisible();
  // The native editor cursor still exists, but must not compete with our marker.
  const nativeCursor = page.locator(
    '.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline',
  );
  await expect(nativeCursor).toHaveCount(1);
  await expect(nativeCursor).toBeHidden();
  await expect(
    page.locator(
      '.studio-rich-drop:visible, .studio-rich-side-drop:visible, .prosemirror-dropcursor-block:visible, .prosemirror-dropcursor-inline:visible',
    ),
  ).toHaveCount(1);
  await page.mouse.up();
  await expect(editor.locator('img')).toHaveCount(1);
  await expect(editor.locator('img')).toHaveClass(/width-50/);
  await expect(editor.locator(':scope > :first-child')).toHaveAttribute(
    'data-rich-image',
    '',
  );
  await page.keyboard.press('Control+z');
  await expect(editor.locator('img')).toHaveCount(1);
  await expect(editor.locator(':scope > :first-child')).toHaveText('Start');
});

test('block handles move content between columns without copying', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Pointer drag uses a mouse');
  await setup(page);
  await openNote(page);
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill(
      ':::columns equal\nLeft text\n\nStay here\n:::column\nRight text\n:::',
    );
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await editor.getByText('Left text', { exact: true }).hover();
  await page
    .getByRole('button', { name: 'Block actions', exact: true })
    .dragTo(editor.getByText('Right text', { exact: true }), {
      targetPosition: { x: 100, y: 18 },
    });
  await expect(editor.locator('.note-column').nth(1)).toContainText(
    'Left text',
  );
  await expect(editor.getByText('Left text', { exact: true })).toHaveCount(1);
  await expect(editor.locator('.note-column')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(editor.locator('.note-column').first()).toContainText(
    'Left text',
  );
});

test('small images stack in the shared public preview', async ({ page }) => {
  await setup(page);
  await openNote(page);
  await page.route('**/images/stack.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"/>',
    }),
  );
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill(
      '<img src="/images/stack.svg" alt="First" class="note-image note-image--width-50">\n\n<img src="/images/stack.svg" alt="Second" class="note-image note-image--width-50">',
    );
  await setView(page, 'Preview');
  const images = page.locator('.studio-preview img');
  await expect(images).toHaveCount(2);
  await expect(images.first()).toHaveCSS('display', 'block');
  const first = await images.first().boundingBox();
  const second = await images.nth(1).boundingBox();
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
});

test('create columns from a block and add a third column', async ({
  page,
}, info) => {
  await setup(page);
  await openNote(page);
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill('Keep this text.');
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  await editor.locator('p').click();
  if (info.project.name === 'desktop') await editor.locator('p').hover();
  await page
    .getByRole('button', { name: 'Block actions', exact: true })
    .click();
  await page.getByRole('button', { name: '2 columns', exact: true }).click();
  await expect(editor.locator('.note-column')).toHaveCount(2);
  await page.keyboard.type('Beside it.');
  await expect(editor.locator('.note-column').nth(1)).toContainText(
    'Beside it.',
  );
  await editor.locator('.note-column').nth(1).locator('p').click();
  await page
    .getByRole('button', { name: 'Block actions', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add column', exact: true }).click();
  await expect(editor.locator('.note-column')).toHaveCount(3);
  await editor.locator('.note-column').nth(2).locator('p').click();
  await page.keyboard.type('One more.');
  await expect(editor.locator('.note-column').first()).toHaveText(
    'Keep this text.',
  );
  await page.screenshot({
    path: `test-results/columns-${info.project.name}.png`,
  });
  await setView(page, 'Markdown');
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /:::columns three[\s\S]*Keep this text.[\s\S]*Beside it.[\s\S]*One more./,
  );
});

test('drag beside a block snaps into columns with a spaced grip', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'Side snapping requires space and a pointer',
  );
  await setup(page);
  await openNote(page);
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill('Keep this text.\n\nMove this beside it.\n\nAdd this too.');
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const source = editor.getByText('Move this beside it.', { exact: true });
  await source.hover();
  const grip = page.getByRole('button', { name: 'Block actions', exact: true });
  const gripBox = (await grip.boundingBox())!;
  const sourceBox = (await source.boundingBox())!;
  expect(sourceBox.x - gripBox.x - gripBox.width).toBeGreaterThanOrEqual(12);
  const target = (await editor
    .getByText('Keep this text.', { exact: true })
    .boundingBox())!;
  await page.mouse.move(
    gripBox.x + gripBox.width / 2,
    gripBox.y + gripBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width - 2,
    target.y + target.height / 2,
    { steps: 12 },
  );
  await expect(page.locator('.studio-rich-side-drop')).toBeVisible();
  await page.screenshot({ path: 'test-results/side-snap-preview.png' });
  await page.mouse.up();
  await expect(editor.locator('.note-column')).toHaveCount(2);
  await expect(editor.locator('.note-column').nth(1)).toHaveText(
    'Move this beside it.',
  );
  await expect(
    editor.getByText('Move this beside it.', { exact: true }),
  ).toHaveCount(1);
  await editor.getByText('Add this too.', { exact: true }).hover();
  const column = editor.locator('.note-column').nth(1);
  const box = (await column.boundingBox())!;
  await grip.dragTo(column, {
    targetPosition: { x: box.width - 2, y: box.height / 2 },
  });
  await expect(editor.locator('.note-column')).toHaveCount(3);
  await expect(editor.locator('.note-column').nth(2)).toHaveText(
    'Add this too.',
  );
  await page.screenshot({ path: 'test-results/side-snap-result.png' });
  await setView(page, 'Markdown');
  await expect(page.getByRole('combobox', { name: 'Note source' })).toHaveValue(
    /:::columns three/,
  );
  await setView(page, 'Preview');
  await expect(page.locator('.studio-preview .note-column')).toHaveCount(3);
});

test('native image drag snaps beside text and undo restores one image', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Native drag requires a mouse');
  await setup(page);
  await openNote(page);
  await page.route('**/images/snap.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="slateblue"/></svg>',
    }),
  );
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill(
      'Beside the image.\n\n<img src="/images/snap.svg" alt="Snap me" class="note-image note-image--width-50">',
    );
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const target = editor.getByText('Beside the image.', { exact: true });
  const box = (await target.boundingBox())!;
  await editor
    .getByRole('img')
    .dragTo(target, { targetPosition: { x: 2, y: box.height / 2 } });
  await expect(editor.locator('.note-column')).toHaveCount(2);
  await expect(
    editor.locator('.note-column').first().locator('img'),
  ).toHaveClass(/width-50/);
  await expect(editor.locator('img')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(editor.locator('.note-column')).toHaveCount(0);
  await expect(editor.locator('img')).toHaveCount(1);
  const image = editor.getByRole('img');
  await image.hover();
  const grip = page.getByRole('button', { name: 'Block actions', exact: true });
  const gripBox = (await grip.boundingBox())!;
  const imageBox = (await image.boundingBox())!;
  expect(imageBox.x - gripBox.x - gripBox.width).toBeGreaterThanOrEqual(12);
  await page.screenshot({ path: 'test-results/image-grip-spacing.png' });
  await target.hover();
  await grip.dragTo(image, {
    targetPosition: { x: imageBox.width - 2, y: imageBox.height / 2 },
  });
  await expect(editor.locator('.note-column')).toHaveCount(2);
  await expect(
    editor.locator('.note-column').first().locator('img'),
  ).toHaveCount(1);
  await expect(editor.locator('.note-column').nth(1)).toHaveText(
    'Beside the image.',
  );
});

test('side snapping cancels with Escape and stays off when columns cannot fit', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'Pointer drag uses desktop layout',
  );
  await setup(page);
  await openNote(page);
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill('Target.\n\nSource.');
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  async function dragToSide() {
    await editor.getByText('Source.', { exact: true }).hover();
    const grip = (await page
      .getByRole('button', { name: 'Block actions', exact: true })
      .boundingBox())!;
    const target = (await editor
      .getByText('Target.', { exact: true })
      .boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width - 2,
      target.y + target.height / 2,
      { steps: 10 },
    );
  }
  await dragToSide();
  await expect(page.locator('.studio-rich-side-drop')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.studio-rich-side-drop')).toHaveCount(0);
  await expect(editor.locator('.note-columns')).toHaveCount(0);
  await expect(editor.locator('p')).toHaveText(['Target.', 'Source.']);
  await page.setViewportSize({ width: 780, height: 1000 });
  await dragToSide();
  await expect(page.locator('.studio-rich-side-drop')).toHaveCount(0);
  await page.mouse.up();
  await expect(editor.locator('.note-columns')).toHaveCount(0);
});

test('images keep their width across repeated snap and unsnap moves', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Native drag requires a mouse');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page);
  await openNote(page);
  await page.route('**/images/layout-*.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="slateblue"/></svg>',
    }),
  );
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill(
      '# Images\n\n<img src="/images/layout-a.svg" alt="A" class="note-image note-image--width-25">\n\n<img src="/images/layout-b.svg" alt="B" class="note-image note-image--width-25">',
    );
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const first = editor.getByRole('img', { name: 'A', exact: true });
  const second = editor.getByRole('img', { name: 'B', exact: true });
  const initialWidth = (await first.boundingBox())!.width;
  for (let i = 0; i < 3; i++) {
    const target = (await first.boundingBox())!;
    await second.dragTo(first, {
      targetPosition: { x: target.width - 2, y: target.height / 2 },
    });
    await expect(editor.locator('.note-column')).toHaveCount(2);
    expect((await first.boundingBox())!.width).toBeCloseTo(initialWidth, 0);
    expect((await second.boundingBox())!.width).toBeCloseTo(initialWidth, 0);
    if (i === 0) {
      await page.screenshot({
        path: 'test-results/stable-image-columns-desktop.png',
      });
      await setView(page, 'Preview');
      const note = page.locator('.studio-preview .prose');
      const noteWidth = (await note.boundingBox())!.width;
      const columnWidth = (await note
        .locator('.note-column')
        .first()
        .boundingBox())!.width;
      expect(
        (await note.locator('img').first().boundingBox())!.width,
      ).toBeCloseTo(Math.min(noteWidth * 0.25, columnWidth), 0);
      await setView(page, 'Visual');
    }
    // The image's write-below affordance creates the otherwise invisible caret paragraph.
    await editor
      .locator('.note-column')
      .first()
      .getByRole('button', { name: 'Write below image' })
      .click();
    const row = (await editor.locator('.note-columns').boundingBox())!;
    const scroll = page.locator('.studio-rich-scroll');
    const scrollBox = (await scroll.boundingBox())!;
    await second.dragTo(scroll, {
      targetPosition: {
        x: target.x - scrollBox.x + 20,
        y: Math.min(
          scrollBox.height - 25,
          row.y + row.height - scrollBox.y + 130,
        ),
      },
    });
    await expect(editor.locator('.note-column')).toHaveCount(0);
    await expect(editor.locator('img')).toHaveCount(2);
    expect((await first.boundingBox())!.width).toBeCloseTo(initialWidth, 0);
    expect((await second.boundingBox())!.width).toBeCloseTo(initialWidth, 0);
  }
  await page.keyboard.press('Control+z');
  await expect(editor.locator('.note-column')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(editor.locator('.note-column')).toHaveCount(0);
  await setView(page, 'Markdown');
  const markdown = await page
    .getByRole('combobox', { name: 'Note source' })
    .inputValue();
  expect(markdown.match(/layout-a.svg/g)).toHaveLength(1);
  expect(markdown.match(/layout-b.svg/g)).toHaveLength(1);
  expect(markdown).not.toContain(':::columns');
  expect(errors).toEqual([]);
});

test('marquee selects blocks for copy, cut, undo and moving together', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'Mouse marquee is a desktop interaction',
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page);
  await openNote(page);
  await setView(page, 'Markdown');
  await page
    .getByRole('combobox', { name: 'Note source' })
    .fill('# Page\n\nAlpha\n\nBeta\n\nGamma');
  await setView(page, 'Visual');
  const editor = page.getByRole('textbox', { name: 'Note editor' });
  const first = (await editor
    .getByText('Alpha', { exact: true })
    .boundingBox())!;
  const second = (await editor
    .getByText('Beta', { exact: true })
    .boundingBox())!;
  await page.mouse.move(first.x + first.width + 24, first.y - 5);
  await page.mouse.down();
  await page.mouse.move(first.x + 20, second.y + second.height + 5, {
    steps: 12,
  });
  await expect(page.locator('.studio-block-marquee')).toBeVisible();
  await expect(editor.locator('.studio-block-selected')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/block-selection.png' });
  await page.mouse.up();
  await expect(page.locator('.studio-block-marquee')).toHaveCount(0);
  await expect(editor.locator('.studio-block-selected')).toHaveCount(2);
  await page.keyboard.press('Control+c');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Alpha');
  expect(copied).toContain('Beta');
  expect(copied).not.toContain('Gamma');
  await page.keyboard.press('Control+x');
  await expect(editor.locator('p')).toHaveText(['Gamma']);
  await page.keyboard.press('Control+z');
  await expect(editor.locator('p')).toHaveText(['Alpha', 'Beta', 'Gamma']);
  await expect(editor.locator('.studio-block-selected')).toHaveCount(2);
  await editor.getByText('Beta', { exact: true }).hover();
  const gamma = editor.getByText('Gamma', { exact: true });
  const box = (await gamma.boundingBox())!;
  await page
    .getByRole('button', { name: 'Block actions', exact: true })
    .dragTo(gamma, { targetPosition: { x: box.width / 2, y: box.height - 1 } });
  await expect(editor.locator('p')).toHaveText(['Gamma', 'Alpha', 'Beta']);
  await expect(editor.locator('.studio-block-selected')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(editor.locator('p')).toHaveText(['Gamma']);
  await page.keyboard.press('Control+z');
  await expect(editor.locator('p')).toHaveText(['Gamma', 'Alpha', 'Beta']);
  await page.keyboard.press('Escape');
  await expect(editor.locator('.studio-block-selected')).toHaveCount(0);
});
