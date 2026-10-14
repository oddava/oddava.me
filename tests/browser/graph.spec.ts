import { expect, test, type Page } from '@playwright/test';

type Point = { x: number; y: number; radius: number };
type Edge = { from: { x: number; y: number }; to: { x: number; y: number } };
declare global {
  interface Window {
    graphProbe: {
      points: Point[];
      edges: Edge[];
      draws: number;
      /** The last frame each canvas drew, kept apart from the shared probe. */
      byCanvas: WeakMap<HTMLCanvasElement, Point[]>;
    };
  }
}
async function setup(page: Page, suffix = '') {
  await page.addInitScript(() => {
    window.graphProbe = {
      points: [],
      edges: [],
      draws: 0,
      byCanvas: new WeakMap(),
    };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      window.graphProbe.points = [];
      window.graphProbe.edges = [];
      window.graphProbe.draws++;
      window.graphProbe.byCanvas.set(this.canvas, []);
      return clear.apply(this, args);
    };
    const endpoints = new WeakMap<
      CanvasRenderingContext2D,
      { x: number; y: number }
    >();
    const moveTo = CanvasRenderingContext2D.prototype.moveTo;
    CanvasRenderingContext2D.prototype.moveTo = function (x, y) {
      endpoints.set(this, { x, y });
      return moveTo.call(this, x, y);
    };
    const lineTo = CanvasRenderingContext2D.prototype.lineTo;
    CanvasRenderingContext2D.prototype.lineTo = function (x, y) {
      const from = endpoints.get(this);
      if (from) window.graphProbe.edges.push({ from, to: { x, y } });
      return lineTo.call(this, x, y);
    };
    const arc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function (...args) {
      const point = { x: args[0], y: args[1], radius: args[2] };
      window.graphProbe.points.push(point);
      window.graphProbe.byCanvas.get(this.canvas)?.push(point);
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
    await new Promise((resolve) => setTimeout(resolve, 900));
    const snapshot = document.querySelector(
      '.interactive-graph__snapshot',
    ) as HTMLCanvasElement;
    const retained = !snapshot.hidden && snapshot.width > 0;
    (
      document.querySelector(
        '[aria-label="Close expanded graph"]',
      ) as HTMLButtonElement
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 900));
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

async function pausedClock(page: Page, suffix = '') {
  await page.clock.install();
  await setup(page, suffix);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.clock.pauseAt(
    new Date(await page.evaluate(() => Date.now() + 1000)),
  );
  // Let the sidebar's arrival nudge cool, so any later motion is the modal's.
  await page.clock.runFor(3000);
}
/** One position per node; the current note's open centre is a second arc. */
function nodes(page: Page) {
  return page.evaluate(() =>
    window.graphProbe.points.filter(
      (point, i, points) =>
        !points
          .slice(0, i)
          .some((other) => other.x === point.x && other.y === point.y),
    ),
  );
}
// The surface fades on the document timeline, which the fake clock does not drive.
const surfaceSettled = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().length === 0);

for (const mode of ['expanded', 'global'] as const) {
  test(`${mode} graph fades in at full size and fades out with nothing moving underneath`, async ({
    page,
  }) => {
    await pausedClock(page, '?global=1');
    // The sidebar's own canvas: the global graph draws on a canvas of its own.
    const sidebar = () =>
      page
        .locator('canvas[role=group]')
        .first()
        .evaluate((canvas: HTMLCanvasElement) =>
          window.graphProbe.byCanvas
            .get(canvas)!
            .reduce((a, b) => (a.radius > b.radius ? a : b)),
        );
    const mini = await sidebar();
    const opened = await page.evaluate((mode) => {
      document
        .querySelector<HTMLButtonElement>(
          `[aria-label="${mode === 'expanded' ? 'Expand graph' : 'Open global graph'}"]`,
        )!
        .click();
      const panel = document.querySelector<HTMLDialogElement>('dialog:modal')!;
      return {
        opacity: Number(getComputedStyle(panel).opacity),
        // Layout size, which the entrance scale does not affect.
        width: panel.offsetWidth,
        height: panel.offsetHeight,
      };
    }, mode);
    expect(opened.opacity).toBeLessThan(0.2);
    await page.clock.runFor(900);
    await surfaceSettled(page);
    const landed = await page.locator('dialog:modal').evaluate((panel) => ({
      opacity: getComputedStyle(panel).opacity,
      width: (panel as HTMLElement).offsetWidth,
      height: (panel as HTMLElement).offsetHeight,
    }));
    // The surface never resizes: it opens at its destination size.
    expect(landed).toEqual({ ...opened, opacity: '1' });
    await page
      .getByRole('button', {
        name:
          mode === 'expanded' ? 'Close expanded graph' : 'Close global graph',
        exact: true,
      })
      .click();
    await expect(page.locator('dialog:modal')).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: mode === 'expanded' ? 'Expand graph' : 'Open global graph',
        exact: true,
      }),
    ).toBeFocused();
    await page.clock.runFor(32);
    // The sidebar comes back exactly where it was, and stays there: no jiggle.
    const returned = await sidebar();
    expect(Math.hypot(returned.x - mini.x, returned.y - mini.y)).toBeLessThan(
      1,
    );
    await page.clock.runFor(400);
    const later = await sidebar();
    expect(Math.hypot(later.x - returned.x, later.y - returned.y)).toBeLessThan(
      0.02,
    );
  });
}

test('expanded graph is live at once, and the sidebar takes keyboard focus after closing', async ({
  page,
}) => {
  await pausedClock(page, '?global=1');
  await page.evaluate(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Expand graph"]')!
      .click(),
  );
  const canvas = page.locator('dialog:modal canvas[role="group"]');
  expect(
    await canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        ) === element
      );
    }),
  ).toBe(true);
  await canvas.focus();
  await page.keyboard.press(']');
  expect(
    await page.locator('dialog:modal [role="status"]').textContent(),
  ).not.toBe('');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  const mini = page.locator('canvas[role="group"]').first();
  await mini.focus();
  await page.keyboard.press(']');
  expect(
    await page
      .locator('dialog')
      .first()
      .locator('[role="status"]')
      .textContent(),
  ).not.toBe('');
  await surfaceSettled(page);
});

test('expanded graph blooms outward from the current note and comes to rest', async ({
  page,
}) => {
  await pausedClock(page);
  await page.evaluate(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Expand graph"]')!
      .click(),
  );
  const spread = async () => {
    const points = await nodes(page);
    const seed = points.reduce((a, b) => (a.radius > b.radius ? a : b));
    return points.map((point) =>
      Math.hypot(point.x - seed.x, point.y - seed.y),
    );
  };
  await page.clock.runFor(16);
  const frames = [await spread()];
  for (let elapsed = 16; elapsed < 900; elapsed += 16) {
    await page.clock.runFor(16);
    frames.push(await spread());
  }
  const rest = frames.at(-1)!;
  expect(frames.every((frame) => frame.length === rest.length)).toBe(true);
  // Gathered at the seed on arrival, then every note only ever moves outward.
  expect(Math.max(...frames[0])).toBeLessThan(Math.max(...rest) * 0.35);
  for (let i = 1; i < frames.length; i++)
    for (let node = 0; node < rest.length; node++)
      expect(frames[i][node]).toBeGreaterThanOrEqual(frames[i - 1][node] - 0.5);
  const settled = await nodes(page);
  await page.clock.runFor(300);
  const resting = await nodes(page);
  expect(
    Math.max(
      ...resting.map((point, i) =>
        Math.hypot(point.x - settled[i].x, point.y - settled[i].y),
      ),
    ),
  ).toBeLessThan(0.02);
});

test('closing mid-open reverses from what is on screen', async ({ page }) => {
  await setup(page, '?global=1');
  const result = await page.evaluate(() => {
    document
      .querySelector<HTMLButtonElement>('[aria-label="Open global graph"]')!
      .click();
    const panel = document.querySelector<HTMLDialogElement>('dialog:modal')!;
    // Hold the fade a third of the way in; wall-clock frames vary too much.
    for (const animation of panel.getAnimations({ subtree: false })) {
      animation.pause();
      animation.currentTime = 90;
    }
    const before = Number(getComputedStyle(panel).opacity);
    panel
      .querySelector<HTMLButtonElement>('[aria-label="Close global graph"]')!
      .click();
    const after = Number(getComputedStyle(panel).opacity);
    return { before, after };
  });
  expect(result.before).toBeGreaterThan(0.3);
  expect(result.before).toBeLessThan(1);
  expect(Math.abs(result.after - result.before)).toBeLessThan(0.02);
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Open global graph', exact: true }),
  ).toBeFocused();
});

test('resizing during the bloom lands the constellation inside the new viewport', async ({
  page,
}) => {
  await pausedClock(page);
  await page.evaluate(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Expand graph"]')!
      .click(),
  );
  await page.clock.runFor(64);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.width - 32,
    height: viewport.height - 64,
  });
  // ResizeObserver is a browser task, independent of the simulated RAF clock.
  await page.waitForTimeout(50);
  await page.clock.runFor(900);
  const box = (await page
    .locator('dialog:modal canvas[role="group"]')
    .boundingBox())!;
  const point = await currentPoint(page);
  expect(box.x + point.x).toBeGreaterThan(0);
  expect(box.x + point.x).toBeLessThan(viewport.width - 32);
  expect(box.y + point.y).toBeGreaterThan(0);
  expect(box.y + point.y).toBeLessThan(viewport.height - 64);
  await page.clock.runFor(300);
  const after = await currentPoint(page);
  expect(Math.hypot(after.x - point.x, after.y - point.y)).toBeLessThan(0.02);
});

test('closing survives a resize, a motion preference change, or a hidden origin', async ({
  page,
}) => {
  await setup(page);
  for (const change of ['resize', 'motion', 'hidden'] as const) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page
      .getByRole('button', { name: 'Open global graph', exact: true })
      .click();
    await surfaceSettled(page);
    await page.evaluate((change) => {
      if (change === 'hidden')
        document.querySelector<HTMLElement>(
          '.interactive-graph__slot',
        )!.style.display = 'none';
      document
        .querySelector<HTMLButtonElement>('[aria-label="Close global graph"]')!
        .click();
    }, change);
    if (change === 'resize')
      await page.setViewportSize({ width: 820, height: 500 });
    if (change === 'motion')
      await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('dialog:modal')).toHaveCount(0);
    await expect(page.locator('[data-closing]')).toHaveCount(0);
    await page
      .locator('.interactive-graph__slot')
      .evaluate((element: HTMLElement) =>
        element.style.removeProperty('display'),
      );
  }
});

test('a responsive hidden origin releases an idle modal focus trap', async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole('button', { name: 'Open global graph', exact: true })
    .click();
  await surfaceSettled(page);
  await page.locator('.interactive-graph').evaluate((element: HTMLElement) => {
    element.style.display = 'none';
  });
  await expect(page.locator('dialog:modal')).toHaveCount(0);
});

test('reduced motion opens and closes immediately without animating', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await setup(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.clock.pauseAt(
    new Date(await page.evaluate(() => Date.now() + 1000)),
  );
  for (const mode of ['expanded', 'global']) {
    const result = await page.evaluate(async (mode) => {
      const opener = document.querySelector<HTMLButtonElement>(
        `[aria-label="${mode === 'expanded' ? 'Expand graph' : 'Open global graph'}"]`,
      )!;
      opener.click();
      const modal = document.querySelector<HTMLDialogElement>('dialog:modal')!;
      // Site-wide reduced motion shortens CSS transitions to 0.01ms rather
      // than removing them; only scripted motion matters here.
      const still = document
        .getAnimations()
        .every(
          (animation) =>
            animation instanceof CSSTransition ||
            animation instanceof CSSAnimation,
        );
      modal.dispatchEvent(new Event('cancel', { cancelable: true }));
      // Closing settles in the same microtask checkpoint, before any paint.
      await null;
      return {
        still,
        closed: !document.querySelector('dialog:modal'),
        focused: document.activeElement === opener,
      };
    }, mode);
    expect(result).toEqual({ still: true, closed: true, focused: true });
    await page.clock.runFor(1000);
    // A real ResizeObserver may enqueue one legitimate repaint after the
    // synthetic clock advances; flush it before checking for an ongoing loop.
    await page.waitForTimeout(50);
    await page.clock.runFor(32);
    const draws = await page.evaluate(() => window.graphProbe.draws);
    const point = await currentPoint(page);
    await page.clock.runFor(300);
    expect(await currentPoint(page)).toEqual(point);
    expect(await page.evaluate(() => window.graphProbe.draws)).toBe(draws);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  }
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
