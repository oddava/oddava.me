// Builds self-contained mockups: inlines DM Sans (base64) and src/base.css
// into each page in src/. No network, no dependencies.
// Usage: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const font = readFileSync(join(here, 'fonts/DMSans-var.ttf')).toString(
  'base64',
);
const base = readFileSync(join(here, 'src/base.css'), 'utf8');

const fontFace = `@font-face {
  font-family: 'DM Sans';
  /* DM Sans, SIL Open Font License 1.1, see fonts/OFL.txt */
  src: url(data:font/ttf;base64,${font}) format('truetype');
  font-weight: 100 1000;
  font-style: normal;
  font-display: swap;
}`;

const style = `<style>\n${fontFace}\n${base}</style>`;

for (const page of ['index', 'a-home', 'a-about', 'b-home', 'b-about']) {
  const src = readFileSync(join(here, `src/${page}.html`), 'utf8');
  if (!src.includes('<!--STYLE-->')) throw new Error(`${page}: no marker`);
  writeFileSync(join(here, `${page}.html`), src.replace('<!--STYLE-->', style));
  console.log(`built ${page}.html`);
}
