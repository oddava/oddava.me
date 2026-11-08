import { expect, test, type Page } from '@playwright/test';

const UPLOADED = '/images/notes/projects/shot.webp';

interface Uploaded {
  type: string;
  name: string;
  bytes: number;
}

/** A large PNG drawn in the page, so the dialog has something to resize. */
async function bigPng(page: Page, width = 3000, height = 2000) {
  const base64 = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#1d3b6e');
      gradient.addColorStop(1, '#e9c46a');
      context.fillStyle = gradient;
      context.fillRect(0, 0, w, h);
      context.fillStyle = '#fff';
      context.fillRect(w * 0.7, h * 0.2, w * 0.2, h * 0.2);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    [width, height],
  );
  return Buffer.from(base64, 'base64');
}

async function openPanel(page: Page) {
  const saved: unknown[] = [];
  const uploads: Uploaded[] = [];
  let projects: unknown[] = [
    {
      id: 'oddava-me',
      name: 'oddava.me',
      description: 'this site.',
      year: 2026,
      stack: ['astro'],
      source: 'https://github.com/oddava/oddava.me',
      hidden: false,
    },
  ];
  let revision = 1;
  let image: Buffer | null = null;

  await page.route('**/api/admin/projects', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      saved.push(body);
      projects = body.projects;
      revision += 1;
    }
    return route.fulfill({ json: { projects, revision } });
  });
  await page.route('**/api/admin/content/media', async (route) => {
    const request = route.request();
    const body = request.postDataBuffer()!;
    const type = /Content-Type: (image\/[a-z]+)/.exec(body.toString('latin1'));
    const name = /filename="([^"]+)"/.exec(body.toString('latin1'));
    uploads.push({
      type: type?.[1] ?? '',
      name: name?.[1] ?? '',
      bytes: body.length,
    });
    image = body;
    return route.fulfill({
      json: {
        media: {
          url: UPLOADED,
          path: 'public/images/notes/projects/shot.webp',
        },
        result: { message: 'Uploaded' },
      },
    });
  });
  await page.route(`**${UPLOADED}`, async (route) =>
    route.fulfill({
      body: await bigPng(page, 1600, 1067),
      contentType: 'image/png',
    }),
  );

  await page.goto('/tests/browser/projects.html');
  await expect(page.getByText('oddava.me', { exact: true })).toBeVisible();
  return { saved, uploads, image: () => image };
}

test('a new image is sized, framed, and uploaded from the dialog', async ({
  page,
}) => {
  const { saved, uploads } = await openPanel(page);
  await page.getByRole('button', { name: 'Edit oddava.me' }).click();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'shot.png',
    mimeType: 'image/png',
    buffer: await bigPng(page),
  });

  const dialog = page.getByRole('dialog', { name: 'Upload image' });
  await expect(dialog).toBeVisible();
  // Larger than a card needs, so it defaults to 1600 on the long edge.
  await expect(dialog.getByRole('button', { name: '1600 px' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByText(/3000×2000 · .* → 1600×1067 · /)).toBeVisible();

  // One 4:3 preview, the card's own frame, is the focus control.
  await expect(dialog.getByRole('figure')).toHaveCount(1);
  const frame = dialog.getByRole('slider', { name: 'Focus point' });
  await expect(frame).toHaveAttribute('aria-valuetext', '50% across, 50% down');
  const box = (await frame.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(4 / 3, 1);

  // Drag the preview left by a quarter: the focus moves right.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(frame).toHaveAttribute('aria-valuetext', '75% across, 50% down');
  await expect(frame).toBeFocused();
  // The arrow keys nudge it one step.
  await frame.press('ArrowDown');
  await expect(frame).toHaveAttribute('aria-valuetext', '75% across, 55% down');

  await dialog.getByLabel('Zoom').fill('1.5');
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog).toBeHidden();

  expect(uploads).toHaveLength(1);
  expect(uploads[0].name).toMatch(/^shot\.(webp|jpg)$/);
  expect(uploads[0].type).toMatch(/^image\/(webp|jpeg)$/);

  await page.getByLabel('image description').fill('the site at night');
  await page.getByRole('button', { name: 'save', exact: true }).click();
  await expect(page.getByText('oddava.me saved.')).toBeVisible();

  const [body] = saved as { projects: { image?: unknown }[] }[];
  expect(body.projects[0].image).toEqual({
    src: UPLOADED,
    alt: 'the site at night',
    x: 75,
    y: 55,
    zoom: 1.5,
  });
});

test('an existing image can be switched to show whole', async ({ page }) => {
  const { saved, uploads } = await openPanel(page);
  await page.getByRole('button', { name: 'Edit oddava.me' }).click();
  await page.locator('#admin-project-image-src').fill(UPLOADED);
  await page.getByLabel('image description').fill('the site');

  await page.getByRole('button', { name: 'Adjust' }).click();
  const dialog = page.getByRole('dialog', { name: 'Adjust image' });
  await expect(dialog.getByText('Size')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Whole image' }).click();
  await expect(dialog.getByLabel('Zoom')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'save', exact: true }).click();
  await expect(page.getByText('oddava.me saved.')).toBeVisible();
  expect(uploads).toHaveLength(0);
  const [body] = saved as { projects: { image?: unknown }[] }[];
  expect(body.projects[0].image).toEqual({
    src: UPLOADED,
    alt: 'the site',
    fit: 'contain',
  });
});

test('escape closes the dialog without changing the draft', async ({
  page,
}) => {
  const { uploads } = await openPanel(page);
  await page.getByRole('button', { name: 'Edit oddava.me' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'shot.png',
    mimeType: 'image/png',
    buffer: await bigPng(page, 800, 600),
  });
  const dialog = page.getByRole('dialog', { name: 'Upload image' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(uploads).toHaveLength(0);
  await expect(page.locator('#admin-project-image-src')).toHaveValue('');
});
