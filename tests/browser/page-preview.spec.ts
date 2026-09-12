import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const previewMarkup = readFileSync(
  new URL('../../src/components/PagePreview.astro', import.meta.url),
  'utf8',
).match(/<aside[\s\S]*?<\/aside>/)![0];

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hover previews are disabled on touch devices.');
  await page.route('**/notes/preview-target', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main><h1>Preview note</h1><p>A useful paragraph with enough text to appear in the hover preview.</p></main>',
    }),
  );
  await page.goto('/tests/browser/search.html');
  await page.evaluate((markup) => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `${markup}<a id="preview-link" href="/notes/preview-target">Hover this note</a>`,
    );
  }, previewMarkup);
  await page.addScriptTag({
    type: 'module',
    url: '/src/components/PagePreview.astro?preview-test.ts',
  });
});

test('opening search dismisses a hovered top-layer preview and prevents reopening', async ({
  page,
}) => {
  await page.locator('#preview-link').hover();
  await expect(page.locator('#page-preview')).toHaveJSProperty(
    'popover',
    'manual',
  );
  await expect(page.locator('#page-preview')).toBeVisible();
  await expect(page.locator('#preview-link')).toHaveAttribute(
    'aria-describedby',
    'page-preview',
  );
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#page-preview')).toBeHidden();
  await expect(page.locator('#preview-link')).not.toHaveAttribute(
    'aria-describedby',
  );
});

test('blur cancels pending intent and closes an open preview', async ({
  page,
}) => {
  await page.locator('#preview-link').hover();
  await expect(page.locator('#page-preview')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#page-preview')).toBeHidden();
  await page.mouse.move(0, 0);
  await page.locator('#preview-link').hover();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(200);
  await expect(page.locator('#page-preview')).toBeHidden();
});
