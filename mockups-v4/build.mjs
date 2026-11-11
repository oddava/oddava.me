// Builds self-contained v4 pages: inlines DM Sans + Lora (base64), base.css,
// the pre-paint script, the shared header/footer/appearance panel, app.js and
// project screenshots (assets/projects, as data URIs).
// Usage: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const b64 = (p) => readFileSync(join(here, p)).toString('base64');

const fonts = `@font-face {
  font-family: 'DM Sans';
  /* DM Sans, SIL OFL 1.1, fonts/DMSans-OFL.txt */
  src: url(data:font/ttf;base64,${b64('fonts/DMSans-var.ttf')}) format('truetype');
  font-weight: 100 1000;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Lora';
  /* Lora, SIL OFL 1.1, fonts/Lora-OFL.txt (reading-font preference only) */
  src: url(data:font/ttf;base64,${b64('fonts/Lora-variable.ttf')}) format('truetype');
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}`;

const parts = {
  '<!--PREPAINT-->': `<script>\n${read('src/prepaint.js')}</script>`,
  '<!--STYLE-->': `<style>\n${fonts}\n${read('src/base.css')}</style>`,
  '<!--FOOTER-->': read('src/footer.html'),
  '<!--PANEL-->': read('src/panel.html'),
  '<!--APP-->': `<script>\n${read('src/app.js')}</script>`,
};

const header = read('src/header.html');

for (const page of ['home', 'projects', 'about']) {
  let html = read(`src/${page}.html`);
  // Header: mark the current page (the wordmark on home).
  const head = header.replace(/\{\{cur:(\w+)\}\}/g, (_, p) =>
    p === page ? ' aria-current="page"' : '',
  );
  html = html.replace('<!--HEADER-->', () => head);
  for (const [marker, value] of Object.entries(parts)) {
    if (!html.includes(marker)) throw new Error(`${page}: missing ${marker}`);
    html = html.replace(marker, () => value);
  }
  html = html.replace(/\{\{img:([\w.-]+)\}\}/g, (_, f) =>
    `data:image/jpeg;base64,${b64(`assets/projects/${f}`)}`,
  );
  writeFileSync(join(here, `${page}.html`), html);
  console.log(`built ${page}.html`);
}
