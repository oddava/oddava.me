import { expect, test, type Page } from '@playwright/test';

// The /sky island in a real browser, on both projects (a desktop and a
// 390px phone): the label on a star closes from anywhere on the page, and
// the composer for a new star stays on the sky by the spot you chose, all
// of it in view, the keyboard's share of the screen included.

const when = new Date(Date.now() - 3 * 3_600_000).toISOString();
const STARS = [
  { id: 'hello', x: 0.5, y: 0.5, word: 'hello', createdAt: when },
  { id: 'quiet', x: 0.8, y: 0.62, createdAt: when },
];

const open = async (
  page: Page,
  stars: unknown[] = STARS,
  mine: unknown[] = [],
) => {
  await page.addInitScript((value) => {
    localStorage.setItem('sky:mine', JSON.stringify(value));
  }, mine);
  await page.route('**/api/sky', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ stars, writable: true }),
    }),
  );
  await page.route('**/api/pulse', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ here: 1, visitors: 1, today: 1 }),
    }),
  );
  await page.goto('/tests/browser/sky.html');
  // Loaded and writable: the lede then says how to leave a star.
  await expect(page.locator('.sky-lede')).toContainText('to leave yours');
};

const tip = (page: Page) => page.locator('.sky-tip');
const surface = (page: Page) => page.locator('.sky-surface');

/** Opens the first star's label from the keyboard, as arrow keys do. */
const labelFirstStar = async (page: Page) => {
  await surface(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tip(page)).toBeVisible();
  await expect(tip(page)).toContainText('“hello”');
};

/** Taps on touch screens, clicks elsewhere: whatever the project does. */
const press = async (
  page: Page,
  isMobile: boolean,
  x: number,
  y: number,
): Promise<void> => {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

test('a star’s label says its word and when, and nothing more', async ({
  page,
}) => {
  // The quiet star is yours, with a word that has not been read yet.
  await open(page, STARS, [{ id: 'quiet', word: 'secret', at: Date.now() }]);
  await surface(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tip(page)).toContainText('“secret”');
  await expect(tip(page).locator('p')).toHaveCount(2);
  await expect(tip(page)).not.toContainText('yours');
  await expect(tip(page)).not.toContainText('read');
});

test('a click or tap anywhere on the page closes the label', async ({
  page,
  isMobile,
}) => {
  await open(page);

  // Off the sky: the title above it.
  await labelFirstStar(page);
  const title = (await page.locator('.pf-title').boundingBox())!;
  await press(page, isMobile, title.x + 4, title.y + title.height / 2);
  await expect(tip(page)).toBeHidden();

  // The bar under the sky.
  await labelFirstStar(page);
  const note = (await page.locator('.sky-bar__note').boundingBox())!;
  await press(page, isMobile, note.x + 4, note.y + note.height / 2);
  await expect(tip(page)).toBeHidden();

  // The label itself, and the tap ends there: it does not fall through to
  // the sky under the label and start a star.
  await labelFirstStar(page);
  const label = (await tip(page).boundingBox())!;
  await press(page, isMobile, label.x + label.width / 2, label.y + 8);
  await expect(tip(page)).toBeHidden();
  await expect(page.locator('.sky-composer')).toHaveCount(0);

  // A tap on the star opens its label; a tap on open sky closes it, and
  // does not start a star in the same tap.
  await labelFirstStar(page);
  const at = (await tip(page).boundingBox())!;
  const star = { x: at.x + at.width / 2, y: at.y + at.height + 16 };
  await page.keyboard.press('Escape');
  await expect(tip(page)).toBeHidden();
  await press(page, isMobile, star.x, star.y);
  await expect(tip(page)).toContainText('“hello”');
  const sky = (await surface(page).boundingBox())!;
  await press(page, isMobile, sky.x + sky.width * 0.3, sky.y + sky.height / 2);
  await expect(tip(page)).toBeHidden();
  await expect(page.locator('.sky-composer')).toHaveCount(0);
});

test('Escape closes the label wherever focus is', async ({ page }) => {
  await open(page);
  await labelFirstStar(page);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(surface(page)).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(tip(page)).toBeHidden();
});

/** The composer's box, the sky's, and the window's, in client px. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
    };
    const view = window.visualViewport!;
    return {
      composer: box('.sky-composer'),
      sky: box('.sky'),
      view: {
        top: view.offsetTop,
        bottom: view.offsetTop + view.height,
        width: view.width,
      },
      position: getComputedStyle(document.querySelector('.sky-composer')!)
        .position,
    };
  });

const expectFullyInView = async (page: Page) =>
  expect
    .poll(async () => {
      const { composer, view } = await measure(page);
      return (
        composer.top >= view.top &&
        composer.bottom <= view.bottom &&
        composer.left >= 0 &&
        composer.right <= view.width
      );
    })
    .toBe(true);

for (const [where, down] of [
  ['high in the sky', 0.3],
  ['low in the sky', 0.62],
] as const) {
  test(`the composer opens on the sky by a spot ${where}`, async ({
    page,
    isMobile,
  }) => {
    await open(page, []);
    const sky = (await surface(page).boundingBox())!;
    const spot = { x: sky.x + sky.width * 0.3, y: sky.y + sky.height * down };
    await press(page, isMobile, spot.x, spot.y);
    const composer = page.locator('.sky-composer');
    await expect(composer).toBeVisible();
    await expect(page.locator('#sky-word')).toBeFocused();
    await expectFullyInView(page);

    const box = await measure(page);
    // On the sky, not docked in the page under it.
    expect(box.position).toBe('absolute');
    expect(box.composer.left).toBeGreaterThanOrEqual(box.sky.left);
    expect(box.composer.right).toBeLessThanOrEqual(box.sky.right);
    // Beside the spot: just above it or just below it (the page may have
    // moved, so measure from the sky's top).
    const spotY = spot.y - sky.y;
    const above = Math.abs(box.composer.bottom - box.sky.top - (spotY - 26));
    const below = Math.abs(box.composer.top - box.sky.top - (spotY + 26));
    expect(Math.min(above, below)).toBeLessThan(4);

    if (isMobile) {
      // A phone keyboard takes about half the screen: all of the composer
      // stays in what is left.
      await page.setViewportSize({ width: 390, height: 330 });
      await expectFullyInView(page);
      await page.locator('#sky-word').fill('a wish');
      await expect(
        page.getByRole('button', { name: 'place star' }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole('button', { name: 'somewhere else' }),
      ).toBeInViewport({ ratio: 1 });
    }
  });
}

test('“somewhere else” keeps the composer in view on a phone', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Only a phone moves the page for the composer.');
  await open(page, []);
  await page.getByRole('button', { name: 'leave a star' }).tap();
  await expect(page.locator('.sky-composer')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 330 });
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'somewhere else' }).tap();
    await expectFullyInView(page);
  }
});
