import { expect, test, type Page } from '@playwright/test';

type Point = { x: number; y: number; radius: number };
declare global {
  interface Window {
    graphProbe: { points: Point[]; draws: number };
  }
}
async function setup(page: Page, suffix = '') {
  await page.addInitScript(() => {
    window.graphProbe = { points: [], draws: 0 };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      window.graphProbe.points = [];
      window.graphProbe.draws++;
      return clear.apply(this, args);
    };
    const arc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function (...args) {
      window.graphProbe.points.push({
        x: args[0],
        y: args[1],
        radius: args[2],
      });
      return arc.apply(this, args);
    };
  });
  await page.goto(`/tests/browser/graph.html${suffix}`);
  await expect
    .poll(() => page.evaluate(() => window.graphProbe.points.length))
    .toBeGreaterThan(0);
}
async function currentPoint(page: Page) {
  return page.evaluate(() =>
    window.graphProbe.points.reduce((a, b) => (a.radius > b.radius ? a : b)),
  );
}

test('expansion preserves camera, Escape restores focus, graph stays before outline', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  const canvas = page.locator('canvas').first();
  const before = await currentPoint(page);
  await page.getByRole('button', { name: 'Expand graph', exact: true }).click();
  await expect(page.locator('dialog').first()).toHaveJSProperty('open', true);
  expect(
    await page
      .locator('dialog')
      .first()
      .evaluate((element) => element.matches(':modal')),
  ).toBe(true);
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Expand graph', exact: true }),
  ).toBeFocused();
  expect(
    await page
      .locator('dialog')
      .first()
      .evaluate((element) => element.matches(':modal')),
  ).toBe(false);
  await expect
    .poll(async () => Math.abs((await currentPoint(page)).x - before.x))
    .toBeLessThan(1);
  await expect
    .poll(async () => Math.abs((await currentPoint(page)).y - before.y))
    .toBeLessThan(1);
  expect(
    await page
      .locator('.interactive-graph')
      .evaluate(
        (element) =>
          !!(
            element.compareDocumentPosition(
              document.querySelector('.note-toc')!,
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('node drag pulls neighbors without navigating, pan and zoom work, simulation sleeps', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'Mouse gestures checked on desktop; touch checked separately.',
  );
  await setup(page, '?full');
  await page.waitForTimeout(2300);
  await expect
    .poll(
      async () => {
        const draws = await page.evaluate(() => window.graphProbe.draws);
        await page.waitForTimeout(250);
        return (await page.evaluate(() => window.graphProbe.draws)) === draws;
      },
      { timeout: 8000 },
    )
    .toBe(true);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const before = await currentPoint(page);
  await page.mouse.move(box.x + before.x, box.y + before.y);
  await page.mouse.down();
  await page.mouse.move(box.x + before.x + 70, box.y + before.y + 35, {
    steps: 12,
  });
  await page.waitForTimeout(200);
  const held = await currentPoint(page);
  expect(held.x).toBeCloseTo(before.x + 70, 0);
  expect(held.y).toBeCloseTo(before.y + 35, 0);
  await page.mouse.up();
  expect(page.url()).not.toContain('#note-');
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.waitForTimeout(2400);
  const settled = await currentPoint(page);
  expect(Math.hypot(settled.x - held.x, settled.y - held.y)).toBeGreaterThan(2);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + 40, { steps: 8 });
  await expect
    .poll(async () => Math.abs((await currentPoint(page)).x - settled.x - 40))
    .toBeLessThan(1);
  await page.mouse.up();
  const radius = (await currentPoint(page)).radius;
  await page.mouse.wheel(0, -100);
  await expect
    .poll(async () => (await currentPoint(page)).radius)
    .toBeGreaterThan(radius);
});

test('keyboard selects and opens notes without extra placeholder text', async ({
  page,
}) => {
  await setup(page, '?full');
  await page.locator('canvas').first().focus();
  await page.keyboard.press(']');
  await expect(page.getByRole('status')).toHaveText('Learning in public');
  await expect(page.locator('body')).not.toContainText('Interactive graph');
  await expect(page.locator('body')).not.toContainText('No linked notes yet');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#note-1$/);
});

test('touch pinch zooms and never activates a note', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Touch fixture');
  await setup(page, '?full');
  const session = await page.context().newCDPSession(page);
  const radius = (await currentPoint(page)).radius;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 120, y: 260, id: 1 },
      { x: 240, y: 260, id: 2 },
    ],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 80, y: 280, id: 1 },
      { x: 280, y: 280, id: 2 },
    ],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect
    .poll(async () => (await currentPoint(page)).radius)
    .toBeGreaterThan(radius * 1.1);
  expect(page.url()).not.toContain('#note-');
});

test('global modal opens lazily, closes promptly, and remains usable in landscape', async ({
  page,
}, testInfo) => {
  await setup(page);
  const globalCanvas = page.locator('canvas[role=group]').nth(1);
  await expect(globalCanvas).not.toHaveAttribute('width');
  if (testInfo.project.name === 'mobile')
    await page.setViewportSize({ width: 844, height: 390 });
  const opener = page.getByRole('button', {
    name: 'Open global graph',
    exact: true,
  });
  for (let i = 0; i < 2; i++) {
    await opener.click();
    const modal = page.locator('dialog:modal');
    await expect(modal).toHaveCount(1);
    await expect(globalCanvas).toHaveAttribute('width', /\d+/);
    const bounds = await modal.evaluate((element) => ({
      height: element.clientHeight,
      scroll: element.scrollHeight,
    }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.height + 1);
    await page
      .getByRole('button', { name: 'Close global graph', exact: true })
      .click();
    await expect(page.locator('dialog:modal')).toHaveCount(0, { timeout: 700 });
    await expect(opener).toBeFocused();
  }
});

test('wheel zoom eases around its anchor and settles without a render loop', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Wheel gesture');
  await setup(page, '?full');
  await expect
    .poll(
      async () => {
        const frames = await page.evaluate(() => window.graphProbe.draws);
        await page.waitForTimeout(180);
        return (await page.evaluate(() => window.graphProbe.draws)) === frames;
      },
      { timeout: 10000 },
    )
    .toBe(true);
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const node = await currentPoint(page);
  await page.mouse.move(box.x + node.x, box.y + node.y);
  await page.waitForTimeout(650);
  const before = await currentPoint(page);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(35);
  const intermediate = await currentPoint(page);
  await page.waitForTimeout(500);
  const after = await currentPoint(page);
  expect(intermediate.radius).toBeGreaterThan(before.radius);
  expect(after.radius).toBeGreaterThan(intermediate.radius);
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  await expect
    .poll(
      async () => {
        const frames = await page.evaluate(() => window.graphProbe.draws);
        await page.waitForTimeout(150);
        return (await page.evaluate(() => window.graphProbe.draws)) === frames;
      },
      { timeout: 2000 },
    )
    .toBe(true);
});

test('sidebar pan release stays bounded and reduced motion has no coast', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Mouse pan');
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await setup(page);
    await page.waitForTimeout(2000);
    const canvas = page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 55, box.y + 20, { steps: 8 });
    await page.waitForTimeout(16);
    const held = await currentPoint(page);
    await page.mouse.up();
    await page.waitForTimeout(450);
    const released = await currentPoint(page);
    const coast = released.x - held.x;
    expect(coast).toBeGreaterThanOrEqual(-1);
    expect(coast).toBeLessThan(reducedMotion === 'reduce' ? 1 : 25);
  }
});

test('modal keeps the mini graph and the entire sidebar in place throughout the transition', async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole('button', { name: 'Expand graph', exact: true })
    .scrollIntoViewIfNeeded();
  const result = await page.evaluate(async () => {
    const slot = document.querySelector('.interactive-graph__slot')!;
    const section = document.querySelector<HTMLElement>('.note-toc')!;
    // The production mobile outline is elsewhere; make this fixture's following
    // section visible so its geometry measures layout rather than a hidden box.
    section.style.display = 'block';
    const before = {
      slot: slot.getBoundingClientRect().height,
      below: section.getBoundingClientRect().top + scrollY,
    };
    const samples: { slot: number; below: number }[] = [];
    let sampling = true;
    const record = () => {
      samples.push({
        slot: slot.getBoundingClientRect().height,
        below: section.getBoundingClientRect().top + scrollY,
      });
      if (sampling) requestAnimationFrame(record);
    };
    record();
    (
      document.querySelector('[aria-label="Expand graph"]') as HTMLButtonElement
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const snapshot = document.querySelector(
      '.interactive-graph__snapshot',
    ) as HTMLCanvasElement;
    const retained = !snapshot.hidden && snapshot.width > 0;
    (
      document.querySelector(
        '[aria-label="Close expanded graph"]',
      ) as HTMLButtonElement
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    sampling = false;
    return {
      before,
      samples,
      retained,
      modal: !!document.querySelector('dialog:modal'),
    };
  });
  expect(result.retained).toBe(true);
  expect(result.modal).toBe(false);
  expect(
    Math.max(
      ...result.samples.map((sample) =>
        Math.abs(sample.slot - result.before.slot),
      ),
    ),
  ).toBeLessThan(1);
  expect(
    Math.max(
      ...result.samples.map((sample) =>
        Math.abs(sample.below - result.before.below),
      ),
    ),
  ).toBeLessThan(1);
  const viewport = page.locator('.interactive-graph__viewport').first();
  const border = await viewport.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  await page.locator('canvas[role=group]').first().focus();
  await expect(viewport).toHaveCSS('border-color', border);
});

test('modal opens without scaling and miniature circles pop on return', async ({
  page,
}) => {
  await setup(page, '?count=1');
  const result = await page.evaluate(async () => {
    document
      .querySelector<HTMLButtonElement>('[aria-label="Expand graph"]')!
      .click();
    await new Promise(requestAnimationFrame);
    const modal = document.querySelector('dialog:modal')!;
    const transform = getComputedStyle(modal).transform;
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close expanded graph"]')!
      .click();
    while (document.querySelector('dialog:modal'))
      await new Promise(requestAnimationFrame);
    const radii: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 450) {
      radii.push(
        Math.max(...window.graphProbe.points.map((point) => point.radius)),
      );
      await new Promise(requestAnimationFrame);
    }
    return { transform, radii };
  });
  expect(result.transform).toBe('none');
  const final = result.radii.at(-1)!;
  expect(Math.min(...result.radii)).toBeLessThan(final * 0.9);
  expect(Math.max(...result.radii)).toBeLessThan(final * 1.1);
});

test('dragging a node along fractional-resolution edges leaves no pixels behind', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop mouse raster check');
  const context = await browser.newContext({
    deviceScaleFactor: 1.5,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    await setup(page, '?count=1');
    const canvas = page.locator('canvas[role=group]').first();
    await canvas.evaluate((element) => {
      element.style.width = '299px';
      element.style.height = '251px';
    });
    await page.waitForTimeout(100);
    const box = (await canvas.boundingBox())!;
    const point = await currentPoint(page);
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.mouse.down();
    for (const [x, y] of [
      [box.width - 1, box.height / 2],
      [box.width / 2, box.height - 1],
      [box.width / 2, box.height / 2],
    ]) {
      await page.mouse.move(box.x + x, box.y + y, { steps: 12 });
      await page.waitForTimeout(50);
    }
    const alpha = await canvas.evaluate((element: HTMLCanvasElement) => {
      const ctx = element.getContext('2d')!;
      const right = ctx.getImageData(
        element.width - 1,
        0,
        1,
        element.height,
      ).data;
      const bottom = ctx.getImageData(
        0,
        element.height - 1,
        element.width,
        1,
      ).data;
      return Math.max(
        ...Array.from(right).filter((_, i) => i % 4 === 3),
        ...Array.from(bottom).filter((_, i) => i % 4 === 3),
      );
    });
    expect(alpha).toBe(0);
    await page.mouse.up();
    await expect(
      page.locator('.interactive-graph__viewport').first(),
    ).toHaveCSS('overflow', 'hidden');
  } finally {
    await context.close();
  }
});

test('full-page graph returns to its source note', async ({ page }) => {
  await setup(page, '?full#place=note-0');
  await expect(
    page.getByRole('link', { name: 'Back to notes' }),
  ).toHaveAttribute('href', '#note-0');
});
