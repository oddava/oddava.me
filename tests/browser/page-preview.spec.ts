import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const previewMarkup = readFileSync(
  new URL('../../src/components/PagePreview.astro', import.meta.url),
  'utf8',
).match(/<aside[\s\S]*?<\/aside>/)![0];

const notePage = (title: string) =>
  `<main><h1>${title}</h1><p>A useful paragraph with enough text to appear in the hover preview.</p></main>`;

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hover previews are disabled on touch devices.');
  await page.route('**/notes/preview-target', (route) =>
    route.fulfill({ contentType: 'text/html', body: notePage('Preview note') }),
  );
  await page.route('**/notes/neighbour', (route) =>
    route.fulfill({ contentType: 'text/html', body: notePage('Neighbour') }),
  );
  await page.goto('/tests/browser/search.html');
  await page.evaluate((markup) => {
    document.body.insertAdjacentHTML('beforeend', markup);
    document.querySelector('main h1')!.insertAdjacentHTML(
      'afterend',
      `<p id="preview-prose" style="max-width: 32rem">
        Some text before <a id="preview-link" href="/notes/preview-target">Hover this note</a>
        and then <a id="neighbour-link" href="/notes/neighbour">a neighbour</a>
        with plain words after it.</p>`,
    );
  }, previewMarkup);
  await page.addScriptTag({
    type: 'module',
    url: '/src/components/PagePreview.astro?preview-test.ts',
  });
});

const sheet = (page: Page) => page.locator('#page-preview');

/** Centre of an element, for pointer paths the hover helper cannot express. */
const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

/** Record every state the sheet passes through. */
const recordStates = (page: Page) =>
  page.evaluate(() => {
    const seen: string[] = [];
    const preview = document.querySelector<HTMLElement>('#page-preview')!;
    new MutationObserver(() => {
      const state = preview.dataset.state;
      if (state && seen.at(-1) !== state) seen.push(state);
    }).observe(preview, { attributeFilter: ['data-state'] });
    (window as unknown as { previewStates: string[] }).previewStates = seen;
  });

const states = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { previewStates: string[] }).previewStates,
  );

test('opening search dismisses a hovered top-layer preview and prevents reopening', async ({
  page,
}) => {
  await page.locator('#preview-link').hover();
  await expect(sheet(page)).toHaveJSProperty('popover', 'manual');
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#preview-link')).toHaveAttribute(
    'aria-describedby',
    'page-preview',
  );
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#preview-link')).not.toHaveAttribute(
    'aria-describedby',
  );
});

test('blur cancels pending intent and closes an open preview', async ({
  page,
}) => {
  await page.locator('#preview-link').hover();
  await expect(sheet(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(sheet(page)).toBeHidden();
  await page.mouse.move(0, 0);
  await page.locator('#preview-link').hover();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(200);
  await expect(sheet(page)).toBeHidden();
});

test('a fast page opens straight into its content, without a skeleton', async ({
  page,
}) => {
  await recordStates(page);
  await page.locator('#preview-link').hover();
  await expect(sheet(page)).toContainText('Preview note');
  expect(await states(page)).toEqual(['ready']);
});

test('a slow page shows a skeleton, then resolves in place', async ({
  page,
}) => {
  await page.route('**/notes/slow', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ contentType: 'text/html', body: notePage('Slow') });
  });
  await page.evaluate(() =>
    document
      .querySelector('#preview-link')!
      .setAttribute('href', '/notes/slow'),
  );
  await recordStates(page);
  await page.locator('#preview-link').hover();
  await expect(sheet(page)).toHaveAttribute('data-state', 'loading');
  await expect(sheet(page)).toContainText('Slow');
  expect(await states(page)).toEqual(['loading', 'ready']);
});

test('the pointer can cross onto the sheet and rest there', async ({
  page,
}) => {
  const link = await centre(page, '#preview-link');
  await page.mouse.move(link.x, link.y);
  await expect(sheet(page)).toBeVisible();

  const panel = (await sheet(page).boundingBox())!;
  await page.mouse.move(panel.x + 40, panel.y + panel.height / 2, {
    steps: 6,
  });
  await page.waitForTimeout(400);
  await expect(sheet(page)).toBeVisible();

  // Off the sheet onto the page lets it go.
  await page.mouse.move(panel.x + panel.width + 80, panel.y + panel.height, {
    steps: 4,
  });
  await expect(sheet(page)).toBeHidden();
});

test('clicking the sheet follows its link', async ({ page }) => {
  await page.locator('#preview-link').hover();
  await expect(sheet(page)).toContainText('Preview note');
  await sheet(page).click();
  await expect(page).toHaveURL(/\/notes\/preview-target$/);
});

test('a broken link says so, quietly', async ({ page }) => {
  await page.route('**/notes/gone', (route) =>
    route.fulfill({ status: 404, contentType: 'text/html', body: '' }),
  );
  await page.evaluate(() =>
    document
      .querySelector('#preview-link')!
      .setAttribute('href', '/notes/gone'),
  );
  await page.locator('#preview-link').hover();
  await expect(sheet(page)).toHaveAttribute('data-state', 'missing');
  await expect(sheet(page)).toContainText('page not found');
  // Nothing to describe: the link's own name is the whole story.
  await expect(page.locator('#preview-link')).not.toHaveAttribute(
    'aria-describedby',
  );
});

test('a transient failure never opens a sheet, and the next hover retries', async ({
  page,
}) => {
  let healthy = false;
  await page.route('**/notes/flaky', (route) =>
    healthy
      ? route.fulfill({ contentType: 'text/html', body: notePage('Flaky') })
      : route.fulfill({ status: 503, contentType: 'text/html', body: '' }),
  );
  await page.evaluate(() =>
    document
      .querySelector('#preview-link')!
      .setAttribute('href', '/notes/flaky'),
  );
  await recordStates(page);
  await page.locator('#preview-link').hover();
  await page.waitForTimeout(400);
  await expect(sheet(page)).toBeHidden();
  expect(await states(page)).toEqual([]);

  healthy = true;
  await page.mouse.move(0, 0);
  await page.locator('#preview-link').hover();
  await expect(sheet(page)).toContainText('Flaky');
});

test('abandoning a swap mid-way still closes the open sheet', async ({
  page,
}) => {
  const first = await centre(page, '#preview-link');
  const second = await centre(page, '#neighbour-link');
  await page.mouse.move(first.x, first.y);
  await expect(sheet(page)).toContainText('Preview note');

  // Brush the neighbour, then leave for plain text before the swap lands.
  await page.mouse.move(second.box.x + 2, second.y);
  await page.mouse.move(second.box.x + second.box.width + 60, second.y);
  await expect(sheet(page)).toBeHidden();
});

test('a pointer sweeping across a link does not open it', async ({ page }) => {
  const link = await centre(page, '#preview-link');
  await page.mouse.move(link.box.x - 20, link.y);
  // ~12px every 16ms: a pass, not a pause.
  for (let x = link.box.x - 20; x < link.box.x + link.box.width + 20; x += 12) {
    await page.mouse.move(x, link.y);
    await page.waitForTimeout(16);
  }
  await page.mouse.move(link.box.x + link.box.width + 40, link.y + 60);
  await page.waitForTimeout(300);
  await expect(sheet(page)).toBeHidden();
});

test('escape dismisses until the reader leaves the link', async ({ page }) => {
  await page.locator('#preview-link').hover();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  const link = await centre(page, '#preview-link');
  await page.mouse.move(link.x + 4, link.y);
  await page.waitForTimeout(300);
  await expect(sheet(page)).toBeHidden();
});

test('keyboard focus opens the sheet and moving focus closes it', async ({
  page,
}) => {
  await page.locator('#preview-link').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(sheet(page)).toContainText('Preview note');
  await expect(page.locator('#preview-link')).toHaveAttribute(
    'aria-describedby',
    'page-preview',
  );
  await page.keyboard.press('Tab');
  await expect(sheet(page)).toContainText('Neighbour');
});
