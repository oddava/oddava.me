import { expect, test, type Page } from '@playwright/test';

const track = {
  isPlaying: true,
  title: 'Q',
  artist: 'Siinamota',
  songUrl: 'https://open.spotify.com/track/q',
  durationMs: 258_000,
  progressMs: 102_000,
  integrations: { spotify: true, lanyard: false },
};

const open = async (page: Page, minimized: boolean) => {
  await page.addInitScript((value) => {
    localStorage.setItem('spotify-widget-minimized', String(value));
    localStorage.removeItem('spotify-widget-pos-v2');
  }, minimized);
  await page.route('**/api/spotify', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(track),
    }),
  );
  await page.goto('/tests/browser/spotify.html');
  await expect(page.locator('.listening')).toHaveClass(/is-active/);
};

const card = (page: Page) => page.locator('.listening__card');

test('names the track and where its link goes', async ({ page }) => {
  await open(page, false);
  await expect(
    page.getByRole('link', {
      name: 'Q by Siinamota — open on Spotify (new tab)',
    }),
  ).toHaveAttribute('href', track.songUrl);
  await expect(page.locator('.listening__label')).toHaveText('listening');
});

test('minimizing closes the pill into a circle and hands focus over', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Keyboard focus handoff is a desktop concern.');
  await open(page, false);
  await page.getByRole('button', { name: 'Minimize now playing' }).focus();
  await page.keyboard.press('Enter');

  const expand = page.getByRole('button', { name: 'Show now playing: Q' });
  await expect(expand).toBeFocused();
  await expect(page.locator('#listening-body')).toHaveAttribute('inert', '');
  await expect
    .poll(async () => {
      const box = (await card(page).boundingBox())!;
      return Math.abs(box.width - box.height);
    })
    .toBeLessThan(1);

  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Minimize now playing' }),
  ).toBeFocused();
  await expect(page.locator('#listening-body')).not.toHaveAttribute('inert');
});

test('a quick click expands the circle without leaving it in drag mode', async ({
  page,
}) => {
  await open(page, true);
  const before = (await page
    .locator('.spotify-widget-positioner')
    .boundingBox())!;
  await page.getByRole('button', { name: 'Show now playing: Q' }).click();
  await expect(page.locator('.listening')).not.toHaveClass(/is-minimized/);

  // A drag left armed by a missed pointerup would carry the widget along.
  await page.mouse.move(before.x + 400, before.y - 300);
  await page.mouse.move(before.x + 420, before.y - 320);
  await expect(page.locator('.spotify-widget-positioner')).not.toHaveClass(
    /is-dragging/,
  );
  const after = (await page
    .locator('.spotify-widget-positioner')
    .boundingBox())!;
  expect(after.x).toBe(before.x);
});

// The star's longest-running animation, measured from the element itself.
const starPulse = (page: Page) =>
  page.locator('.listening__star').evaluate((star) =>
    star.getAnimations().map((animation) => {
      const timing = animation.effect!.getComputedTiming();
      return {
        end: Number(timing.endTime),
        current: Number(animation.currentTime),
      };
    }),
  );

test('the star pulses for five seconds at most, then rests', async ({
  page,
}) => {
  await open(page, false);
  const pulses = await starPulse(page);
  expect(pulses.length).toBeGreaterThan(0);
  for (const pulse of pulses) expect(pulse.end).toBeLessThanOrEqual(5000);
});

test('a new track pulses the star again within the same five seconds', async ({
  page,
}) => {
  let polls = 0;
  await page.route('**/api/spotify', (route) => {
    polls += 1;
    const next =
      polls > 1
        ? { title: 'Next', songUrl: 'https://open.spotify.com/track/next' }
        : {};
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...track, ...next }),
    });
  });
  await page.goto('/tests/browser/spotify.html');
  await expect(page.locator('.listening')).toHaveClass(/is-active/);
  await expect(page.locator('.listening__card')).toContainText('Next', {
    timeout: 12_000,
  });
  const pulses = await starPulse(page);
  expect(pulses.length).toBeGreaterThan(0);
  for (const pulse of pulses) {
    expect(pulse.end).toBeLessThanOrEqual(5000);
    // A fresh activation, not the first track's pulse carried over.
    expect(pulse.current).toBeLessThan(5000);
  }
});

test('a pause saved on any other page holds the star still', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('oddava:motion', 'paused'),
  );
  await open(page, false);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
  expect(await starPulse(page)).toEqual([]);
});

test('reduced motion keeps the star still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, false);
  expect(await starPulse(page)).toEqual([]);
});
