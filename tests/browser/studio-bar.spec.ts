import { test, expect, type Page } from '@playwright/test';

// Where the editor's features meet. Seven of them share one bar, and each was
// built with the bar to itself: together they left the note's name no room,
// hung a panel off the edge of a phone, and let a long heading out of the
// outline. These pin the seams, by measuring rather than by screenshot.

const TITLE = 'A remarkably long title about the quiet hour before the rain';
const HEADING =
  'A very long heading that keeps going well past what a narrow outline panel can show';
const filler = Array.from(
  { length: 8 },
  (_, index) =>
    `Paragraph ${index + 1} wanders along for a while, collecting small thoughts about gardens, kettles and the quiet hour before the rain.`,
).join('\n\n');

async function setup(page: Page) {
  const entry = {
    id: 'welcome',
    title: TITLE,
    folder: '',
    path: 'welcome.md',
    href: '/notes/welcome',
    revision: 'r1',
    draft: true,
    fields: { draft: true },
    body: `# ${TITLE}\n\n${filler}\n\n## ${HEADING}\n\n${filler}\n`,
  };
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
    if (path.endsWith('/connections'))
      return route.fulfill({
        json: {
          connections: { id: entry.id, backlinks: [], outbound: [] },
          tags: [],
        },
      });
    if (path.endsWith('/notes'))
      return route.fulfill({
        json: { collection, entries: [entry], folders: [] },
      });
    if (request.method() === 'PUT')
      return route.fulfill({
        json: { entry, result: { revision: 'r1', message: 'Saved' } },
      });
    return route.fulfill({ json: { collection, entry } });
  });
  await page.goto('/tests/browser/');
  const desktopFile = page.locator('[data-tree-key="entry:welcome"]');
  const mobileFile = page.locator('.studio-mfiles__open').first();
  await expect(desktopFile.or(mobileFile)).toBeVisible();
  if (await desktopFile.isVisible()) await desktopFile.click();
  else await mobileFile.click();
  await expect(
    page.getByRole('textbox', { name: 'Note editor' }),
  ).toBeVisible();
}

test('the bar keeps the note name readable at every width', async ({
  page,
  isMobile,
}) => {
  await setup(page);
  const bar = page.locator('.studio-bar');
  const name = bar.locator('.studio-bar__title strong');
  // A dozen letters of the name, with its ellipsis, at the bar's type size.
  const DOZEN_LETTERS = 90;

  for (const width of isMobile ? [390, 360] : [1280, 1024, 900, 780, 721]) {
    await page.setViewportSize({ width, height: 800 });
    if (isMobile) {
      // A phone's bar takes the name once the page's own title has scrolled
      // away, and says a draft is a draft beside it.
      await page
        .locator('.studio-rich-scroll')
        .evaluate((pane) => pane.scrollTo(0, 600));
      await expect(page.locator('.studio-editor')).toHaveClass(/is-past-title/);
      await expect(bar.locator('.studio-draft-mark')).toBeVisible();
    }
    await expect
      .poll(async () => (await name.boundingBox())?.width ?? 0, {
        message: `the name's width in a ${width}px window`,
      })
      .toBeGreaterThanOrEqual(DOZEN_LETTERS);
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    // Nothing is pushed out of the bar to make that room.
    expect(
      await bar.evaluate((node) => node.scrollWidth <= node.clientWidth),
      `the bar's contents fit a ${width}px window`,
    ).toBe(true);
  }
});

test('the page style panel opens inside the screen', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Page style' }).click();
  const panel = page.getByRole('dialog', { name: 'Page style' });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  // Its first label is whole, not cut by the screen's edge.
  await expect(panel.getByText('Text size')).toBeInViewport({ ratio: 1 });
});

test('a long heading stays inside the outline', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Outline' }).click();
  const outline = page.getByRole('dialog', { name: 'Outline' });
  const row = outline.getByRole('button', { name: HEADING });
  await expect(row).toBeVisible();
  const panel = (await outline.boundingBox())!;
  const box = (await row.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
});

test('phone: history is a row in the note actions, not a button in the bar', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Phone layout only.');
  await setup(page);
  await expect(
    page
      .locator('.studio-bar')
      .getByRole('button', { name: 'Version history' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Note actions', exact: true }).click();
  await expect(
    page.locator('.studio-sheet').getByRole('button', {
      name: 'Version history',
    }),
  ).toBeVisible();
});
