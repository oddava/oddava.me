import { test, expect } from '@playwright/test';
import { mockAdmin } from './admin-mocks';

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank');
});

async function open(page: import('@playwright/test').Page) {
  const state = await mockAdmin(page);
  await page.goto('/tests/browser/admin.html');
  await expect(page.locator('.adm-project')).toHaveCount(4);
  return state;
}

test('approving takes the entry off the inbox, and undo puts it back', async ({
  page,
}) => {
  const state = await open(page);
  const pendingTab = page
    .locator('#guestbook')
    .getByRole('button', { name: /^pending/ });
  await expect(pendingTab).toContainText('3');

  await page.getByRole('button', { name: 'Approve mira' }).click();
  await expect(page.getByRole('button', { name: 'Approve mira' })).toHaveCount(
    0,
  );
  await expect(pendingTab).toContainText('2');
  // The inbox updates before the request lands, so wait for the mock to see it.
  await expect
    .poll(() => state.guestbook.find((e) => e.id === 'g1')?.status)
    .toBe('approved');

  await page.getByRole('button', { name: 'undo' }).click();
  await expect(
    page.getByRole('button', { name: 'Approve mira' }),
  ).toBeVisible();
  await expect
    .poll(() => state.guestbook.find((e) => e.id === 'g1')?.status)
    .toBe('pending');
});

test('a project moves with the arrow keys and saves once per move', async ({
  page,
}) => {
  const state = await open(page);
  const grip = page.getByRole('button', { name: /^Reorder Ishbay/ });
  await grip.focus();
  await page.keyboard.press('ArrowUp');

  await expect(page.locator('.adm-project__name').first()).toHaveText('Ishbay');
  await expect.poll(() => state.saves.length).toBe(1);
  // Focus stays on the moved row's grip, so the next press keeps moving it.
  await expect(
    page.getByRole('button', { name: /^Reorder Ishbay, position 1/ }),
  ).toBeFocused();
});

test('hiding a project is immediate and undoable', async ({ page }) => {
  const state = await open(page);
  const eye = page.getByRole('button', { name: 'Hide Ishbay from the page' });
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => state.projects.find((p) => p.id === 'p2')?.hidden)
    .toBe(true);

  await page.getByRole('button', { name: 'undo' }).click();
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() => state.projects.find((p) => p.id === 'p2')?.hidden)
    .toBe(false);
});

test('focus moves on to the next entry after a decision', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Reject mira' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Approve tomasz' }),
  ).toBeFocused();
});

test('held arrow keys reorder without dropping presses', async ({ page }) => {
  const state = await open(page);
  await page.getByRole('button', { name: /^Reorder AniShows/ }).focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.adm-project__name').first()).toHaveText(
    'AniShows',
  );
  await expect.poll(() => state.saves.length).toBe(3);
  expect(state.conflicts).toBe(0);
  expect((state.projects[0] as { id: string }).id).toBe('p4');
});

test('the editor asks before discarding edits, and saves through the sheet', async ({
  page,
}) => {
  const state = await open(page);
  await page.getByRole('button', { name: 'Edit oddava.me' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  await sheet.getByLabel('description').fill('this site, rebuilt');
  await page.keyboard.press('Escape');
  await expect(sheet.getByText('discard your changes?')).toBeVisible();
  await sheet.getByRole('button', { name: 'keep editing' }).click();

  await sheet.getByRole('button', { name: 'save' }).click();
  await expect(sheet).toBeHidden();
  await expect
    .poll(() => state.projects.find((p) => p.id === 'p3')?.description)
    .toBe('this site, rebuilt');
});

test('an integration switch acts at once, without a dialog', async ({
  page,
}) => {
  const state = await open(page);
  const spotify = page.getByRole('switch', { name: 'Spotify' });
  await expect(spotify).toBeChecked();
  await spotify.click();
  await expect(spotify).not.toBeChecked();
  await expect
    .poll(() => state.integrations.find((i) => i.id === 'spotify')?.enabled)
    .toBe(false);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('switching guestbook tabs shows that tab at once, with no loading flash', async ({
  page,
}) => {
  await open(page);
  const guestbook = page.locator('#guestbook');
  // Every switch below must land without a skeleton ever appearing.
  await page.evaluate(() => {
    const seen = { skeleton: false };
    (window as unknown as { seen: typeof seen }).seen = seen;
    new MutationObserver(() => {
      if (document.querySelector('#guestbook .adm-skeletons')) {
        seen.skeleton = true;
      }
    }).observe(document.getElementById('guestbook')!, {
      childList: true,
      subtree: true,
    });
  });

  await page
    .locator('#guestbook')
    .getByRole('button', { name: 'approved', exact: true })
    .click();
  await expect(
    guestbook.getByText('the notes graph is beautiful.'),
  ).toBeVisible();
  await expect(guestbook.getByText('hello from kraków')).toHaveCount(0);

  await page
    .locator('#guestbook')
    .getByRole('button', { name: 'rejected', exact: true })
    .click();
  await expect(guestbook.getByText('no rejected entries.')).toBeVisible();

  await page
    .locator('#guestbook')
    .getByRole('button', { name: /^pending/ })
    .click();
  await expect(guestbook.getByText(/hello from kraków/)).toBeVisible();

  expect(
    await page.evaluate(
      () =>
        (window as unknown as { seen: { skeleton: boolean } }).seen.skeleton,
    ),
  ).toBe(false);
});

type Status = 'pending' | 'approved' | 'rejected';

/**
 * Holds the next guestbook read for `status` until released, then answers
 * with the list as it stood when the read was made — a slow, stale response.
 * Later reads pass straight through to the mock.
 */
async function holdNextRead(
  page: import('@playwright/test').Page,
  state: import('./admin-mocks').AdminMockState,
  status: Status,
) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const held = { taken: false };
  await page.route(
    (url) =>
      url.pathname === '/api/guestbook/admin' &&
      url.searchParams.get('status') === status,
    async (route) => {
      if (route.request().method() !== 'GET' || held.taken) {
        return route.fallback();
      }
      held.taken = true;
      const stale = state.guestbook
        .filter((e) => e.status === status)
        .map((e) => ({ ...e }));
      await released;
      await route.fulfill({ json: { entries: stale } });
    },
  );
  return { held, release };
}

test('a slow refresh does not bring back an entry decided meanwhile', async ({
  page,
}) => {
  const state = await open(page);
  const { held, release } = await holdNextRead(page, state, 'pending');

  // Coming back to the tab starts a refresh, which the server sits on.
  await page
    .locator('#guestbook')
    .getByRole('button', { name: 'approved', exact: true })
    .click();
  await page
    .locator('#guestbook')
    .getByRole('button', { name: /^pending/ })
    .click();
  await expect.poll(() => held.taken).toBe(true);

  await page.getByRole('button', { name: 'Approve mira' }).click();
  await expect(page.getByRole('button', { name: 'Approve mira' })).toHaveCount(
    0,
  );

  release();
  await page.waitForTimeout(300);
  await expect(page.getByRole('button', { name: 'Approve mira' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'Approve tomasz' }),
  ).toBeVisible();
});

test('a slow refresh does not bring back entries just cleared', async ({
  page,
}) => {
  const state = await open(page);
  const { held, release } = await holdNextRead(page, state, 'pending');

  await page
    .locator('#guestbook')
    .getByRole('button', { name: 'approved', exact: true })
    .click();
  await page
    .locator('#guestbook')
    .getByRole('button', { name: /^pending/ })
    .click();
  await expect.poll(() => held.taken).toBe(true);

  await page.getByRole('button', { name: 'clear unapproved' }).click();
  await page.getByRole('button', { name: 'delete entries' }).click();
  await expect(
    page.getByText('pending and rejected entries deleted.'),
  ).toBeVisible();

  release();
  await page.waitForTimeout(300);
  await expect(page.getByRole('button', { name: /^Approve / })).toHaveCount(0);
  await expect(page.locator('#guestbook .adm-quiet')).toBeVisible();
});

test('a failed prefetch does not flash an error when the tab is opened', async ({
  page,
}) => {
  const state = await mockAdmin(page);
  let reads = 0;
  await page.route(
    (url) =>
      url.pathname === '/api/guestbook/admin' &&
      url.searchParams.get('status') === 'approved',
    async (route) => {
      reads += 1;
      // The prefetch fails; the read on opening the tab is slow but fine.
      if (reads === 1) {
        return route.fulfill({ status: 500, json: { error: 'down' } });
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route.fallback();
    },
  );
  await page.goto('/tests/browser/admin.html');
  await expect(page.locator('.adm-project')).toHaveCount(4);
  await expect.poll(() => reads).toBe(1);

  await page.evaluate(() => {
    const seen = { alert: false };
    (window as unknown as { seen: typeof seen }).seen = seen;
    new MutationObserver(() => {
      if (document.querySelector('#guestbook [role="alert"]')) {
        seen.alert = true;
      }
    }).observe(document.getElementById('guestbook')!, {
      childList: true,
      subtree: true,
    });
  });

  await page
    .locator('#guestbook')
    .getByRole('button', { name: 'approved', exact: true })
    .click();
  await expect(
    page.locator('#guestbook').getByText('the notes graph is beautiful.'),
  ).toBeVisible();
  expect(state.guestbook.some((e) => e.status === 'approved')).toBe(true);
  expect(
    await page.evaluate(
      () => (window as unknown as { seen: { alert: boolean } }).seen.alert,
    ),
  ).toBe(false);
});

test('an approved entry is on the approved tab at once', async ({ page }) => {
  const state = await open(page);
  await page.getByRole('button', { name: 'Approve mira' }).click();
  await expect(page.getByRole('button', { name: 'Approve mira' })).toHaveCount(
    0,
  );

  // The server never answers the read the tab makes; the moved entry is
  // already there.
  await holdNextRead(page, state, 'approved');
  await page
    .locator('#guestbook')
    .getByRole('button', { name: 'approved', exact: true })
    .click();
  await expect(
    page.locator('#guestbook').getByText(/no-guessing rule/),
  ).toBeVisible();
  await expect(
    page.locator('#guestbook').getByText('the notes graph is beautiful.'),
  ).toBeVisible();
});

test('the apps open where they live', async ({ page }) => {
  await open(page);
  const apps = page.locator('#apps');
  await expect(apps.getByRole('link')).toHaveCount(4);
  await expect(apps.getByRole('link', { name: /^notes/ })).toHaveAttribute(
    'href',
    '/admin/files',
  );
  await expect(apps.getByRole('link', { name: /^notes/ })).not.toHaveAttribute(
    'target',
    '_blank',
  );
  for (const [name, href] of [
    ['zipline', 'https://i.oddava.me'],
    ['beszel', 'https://stats.oddava.me'],
    ['dozzle', 'https://logs.oddava.me'],
  ]) {
    const link = apps.getByRole('link', { name: new RegExp(`^${name}`) });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAccessibleName(/opens in new tab/);
  }
});

test('on a phone the stuck section row takes taps under the header', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  // Integrations and its dot stay on the row; apps is rail-only.
  const row = page.locator('.cab-sections');
  const integrations = row.getByRole('link', { name: /^integrations/ });
  await expect(row.getByRole('link', { name: 'apps' })).toBeHidden();
  const rowBox = (await row.boundingBox())!;
  const linkBox = (await integrations.boundingBox())!;
  expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(
    rowBox.x + rowBox.width,
  );

  await page.mouse.wheel(0, 900);
  // Fully stuck: the row sits right on the header's bottom edge.
  const headerBottom = await page
    .locator('.pf-page > .pf-header')
    .evaluate((header) => header.getBoundingClientRect().bottom);
  await expect
    .poll(async () => (await row.boundingBox())!.y)
    .toBeLessThanOrEqual(headerBottom + 1);
  // At the link's own point nothing laid over the row takes the tap.
  const hit = await integrations.evaluate((link) => {
    const box = link.getBoundingClientRect();
    const top = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return link.contains(top);
  });
  expect(hit).toBe(true);
  await integrations.click();
  await expect(integrations).toHaveAttribute('aria-current', 'location');
});

test('on a touch screen the external apps show their arrow', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile', 'touch only');
  await open(page);
  const arrow = page
    .locator('#apps')
    .getByRole('link', { name: /^zipline/ })
    .locator('.pf-arrow');
  await expect
    .poll(() => arrow.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1');
});

test('at the smallest width the row still holds integrations and its dot', async ({
  page,
}, info) => {
  // A phone: its scrollbars overlay. A 320px desktop window gives 15px of
  // its width to a classic scrollbar, which no phone does.
  test.skip(info.project.name !== 'mobile', 'phone only');
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  // The list is what clips: it must not need to scroll at all.
  const list = page.locator('.cab-sections ul');
  await expect(page.locator('.cab-sections__dot')).toBeVisible();
  const fits = await list.evaluate((ul) => ul.scrollWidth <= ul.clientWidth);
  expect(fits).toBe(true);
});

test('a failed projects load leaves the count out', async ({ page }) => {
  await mockAdmin(page);
  await page.route(
    (url) => url.pathname === '/api/admin/projects',
    (route) => route.fulfill({ status: 500, json: { error: 'down' } }),
  );
  await page.goto('/tests/browser/admin.html');
  await expect(page.locator('#projects').getByRole('alert')).toBeVisible();
  await expect(
    page.locator('.cab-sections').getByRole('link', { name: /^projects/ }),
  ).toHaveText('projects');
});

test('at 200% text on a small screen the confirm actions stay reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.getByRole('button', { name: 'clear unapproved' }).click();
  const dialog = page.locator('.confirm-dialog');
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(568);
  for (const name of ['keep them', 'delete entries']) {
    const button = dialog.getByRole('button', { name });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport({ ratio: 1 });
  }
});
