// Writes QA variants of the built pages into a directory you pass in.
// Each variant appends one probe; html_preview then reports console output.
// Usage: node qa.mjs <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) throw new Error('pass an output directory');
mkdirSync(out, { recursive: true });

// Audit: headings, links, hash targets, nesting, contrast, sizes, resources.
const audit = `<script>
addEventListener('load', () => document.fonts.ready.then(() => {
  const lum = (c) => {
    const m = c.match(/[\\d.]+/g).map(Number);
    const ch = m.slice(0, 3).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const texts = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const el = n.parentElement;
    if (!n.textContent.trim() || el.closest('script,style')) continue;
    if (el.closest('.skip')) continue;
    const s = getComputedStyle(el);
    texts.push({ t: n.textContent.trim().slice(0, 24), c: s.color, fs: parseFloat(s.fontSize), fw: s.fontWeight });
  }
  const minRatio = Math.min(...texts.map((t) => ratio(t.c, 'rgb(255,255,255)')));
  const minHoverRatio = Math.min(...texts.map((t) => ratio(t.c, 'rgb(242,245,249)')));
  const links = [...document.querySelectorAll('a')].map((a) => {
    const r = a.getBoundingClientRect();
    const href = a.getAttribute('href');
    let target = 'external';
    if (href.startsWith('#')) target = document.querySelector(href) ? 'ok' : 'MISSING';
    else if (!/^https?:/.test(href)) target = 'file:' + href;
    return { text: a.textContent.trim().replace(/\\s+/g, ' ').slice(0, 20), href, target, w: Math.round(r.width), h: Math.round(r.height) };
  });
  const nested = document.querySelectorAll('a a, a button, button a').length;
  const res = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => !u.startsWith('data:'));
  console.log(JSON.stringify({
    h1: document.querySelectorAll('h1').length,
    font: document.fonts.check('500 17px "DM Sans"'),
    minFontPx: Math.min(...texts.map((t) => t.fs)),
    minRatio: +minRatio.toFixed(2),
    minRatioOnHover: +minHoverRatio.toFixed(2),
    notesLinks: links.filter((l) => l.href.includes('notes.oddava.me')).length,
    nested,
    externalResources: res,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    linkCount: links.length,
    problems: links.filter((l) => l.target === 'MISSING' || l.h < 24),
    files: [...new Set(links.filter((l) => l.target.startsWith('file:')).map((l) => l.href))],
  }));
}));
</script>`;

// Focus probe: keyboard-style focus on the first project link.
const focus = `<script>
addEventListener('load', () => {
  const el = document.querySelector('.row, .entry') || document.querySelector('main a');
  el.focus({ focusVisible: true });
  console.log('focused', el.textContent.trim().slice(0, 20), getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineColor);
});
</script>`;

// Text-only enlargement: root font size doubled (rem-based type scales).
const bigText = `<style>:root:root{font-size:200%}</style>`;

for (const page of ['a-home', 'a-about', 'b-home', 'b-about']) {
  const src = readFileSync(join(here, `${page}.html`), 'utf8');
  const add = (tag, extra) =>
    writeFileSync(
      join(out, `${page}.${tag}.html`),
      src.replace('</body>', `${extra}</body>`),
    );
  add('audit', audit);
  add('focus', focus);
  add('bigtext', bigText);
}
console.log('wrote QA variants to', out);
