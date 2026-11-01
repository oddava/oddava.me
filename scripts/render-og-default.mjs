// Renders public/og-default.png from scripts/og-default-card.ts in headless
// Chromium, with the site's own fonts. Run after changing the card or the cat.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'vite';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const outputPath = path.join(projectRoot, 'public', 'og-default.png');

const bundle = await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    minify: false,
    lib: {
      entry: path.join(projectRoot, 'scripts', 'og-default-card.ts'),
      formats: ['iife'],
      name: 'OgDefaultCard',
    },
  },
});
const script = [bundle].flat()[0].output[0].code;

async function fontFace(family, weight, file) {
  const data = await readFile(path.join(projectRoot, 'public', 'fonts', file));
  return `@font-face { font-family: '${family}'; font-weight: ${weight}; src: url(data:font/woff2;base64,${data.toString('base64')}) format('woff2'); }`;
}
const fonts = await fontFace(
  'M PLUS Rounded 1c',
  700,
  'm-plus-rounded-1c-latin-700-normal.woff2',
);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(
    `<!doctype html><style>${fonts}</style><canvas></canvas><script>${script}</script>`,
  );
  const dataUrl = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    await window.OgDefaultCard.paintCard(canvas);
    return canvas.toDataURL('image/png');
  });
  await writeFile(outputPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
} finally {
  await browser.close();
}
