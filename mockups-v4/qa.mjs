// Writes QA probe variants of the built pages into <outDir>.
//   head probes run before the page's pre-paint script (seed or block storage)
//   body probes run after load (open the panel, audit, exercise controls)
// Usage: node qa.mjs <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) throw new Error('pass an output directory');
mkdirSync(out, { recursive: true });

const seed = (prefs) =>
  `<script>try{localStorage.setItem('appearance',${JSON.stringify(JSON.stringify(prefs))})}catch(e){}</script>`;
const clear = `<script>try{localStorage.removeItem('appearance')}catch(e){}</script>`;
const deny = `<script>(function(){var t=function(){throw new DOMException('denied','SecurityError')};Object.defineProperty(window,'localStorage',{get:t,configurable:true});})();</script>`;

const openPanel = `<script>addEventListener('load',()=>document.fonts.ready.then(()=>{const t=document.getElementById('appearance-toggle'),p=document.getElementById('appearance-panel');t.click();document.getAnimations().forEach((x)=>x.finish());const f=document.activeElement&&document.activeElement.name+'='+document.activeElement.value;document.activeElement.blur();const r=p.getBoundingClientRect(),b=t.getBoundingClientRect(),vw=document.documentElement.clientWidth;console.log(JSON.stringify({open:!p.hidden,focusOnOpen:f,above:p.classList.contains('above'),panel:{l:Math.round(r.left),r:Math.round(r.right),t:Math.round(r.top),b:Math.round(r.bottom),w:Math.round(r.width)},icon:{l:Math.round(b.left),r:Math.round(b.right),t:Math.round(b.top),b:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height)},vw,insideX:r.left>=0&&r.right<=vw,rightAligned:Math.abs(r.right-b.right)<1.5||r.left<=12.5,scrollW:document.documentElement.scrollWidth,name:t.getAttribute('aria-labelledby')&&document.getElementById(t.getAttribute('aria-labelledby')).textContent}));}));</script>`;

// Contrast + structure audit against the theme actually rendered.
const audit = `<script>
addEventListener('load', () => document.fonts.ready.then(() => {
  const rgb = (c) => c.match(/[\\d.]+/g).map(Number);
  const lum = (c) => { const ch = rgb(c).slice(0,3).map((v)=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4}); return 0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2]; };
  const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
  const cs = getComputedStyle(document.documentElement);
  const bg = getComputedStyle(document.body).backgroundColor;
  const probe = document.createElement('span'); document.body.append(probe);
  const tok = (name) => { probe.style.color = 'var(' + name + ')'; return getComputedStyle(probe).color; };
  const hover = tok('--hover'), accent = tok('--accent'), focus = tok('--focus'), ink2 = tok('--ink-2'), ink = tok('--ink'), panelBg = tok('--panel');
  probe.remove();
  const texts = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const el = n.parentElement; if (!n.textContent.trim() || el.closest('script,style,.skip,[hidden]')) continue; const s = getComputedStyle(el); if (s.opacity === '0') continue; texts.push({ c: s.color, fs: parseFloat(s.fontSize), t: n.textContent.trim().slice(0, 18) }); }
  const minText = texts.reduce((m, t) => { const r = ratio(t.c, bg); return r < m.r ? { r, t: t.t } : m; }, { r: 99 });
  const links = [...document.querySelectorAll('a')].map((a) => { const href = a.getAttribute('href'); const r = a.getBoundingClientRect(); let target = /^(https?:|mailto:)/.test(href) ? 'external' : href.startsWith('#') ? (document.querySelector(href) ? 'ok' : 'MISSING') : 'file:' + href; return { href, target, h: Math.round(r.height) }; });
  const res = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => !u.startsWith('data:'));
  console.log(JSON.stringify({
    attrs: ['theme','ink','read','size','density','motion'].map((k) => k + '=' + document.documentElement.getAttribute('data-' + k)).join(' '),
    bg, minText: { ratio: +minText.r.toFixed(2), at: minText.t },
    accentOnBg: +ratio(accent, bg).toFixed(2), accentOnHover: +ratio(accent, hover).toFixed(2), ink2OnHover: +ratio(ink2, hover).toFixed(2),
    inkOnPanel: +ratio(ink, panelBg).toFixed(2), ink2OnPanel: +ratio(ink2, panelBg).toFixed(2), focusOnBg: +ratio(focus, bg).toFixed(2),
    minFontPx: Math.min(...texts.map((t) => t.fs)), h1: document.querySelectorAll('h1').length,
    notesLinks: links.filter((l) => (l.href || '').includes('notes.oddava.me')).length,
    missing: links.filter((l) => l.target === 'MISSING').length, smallTargets: links.filter((l) => l.h < 24).map((l) => l.href),
    nested: document.querySelectorAll('a a, a button, button a').length, externalResources: res,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    fonts: { dm: document.fonts.check('500 17px "DM Sans"'), lora: document.fonts.check('400 17px "Lora"'), proseFamily: getComputedStyle(document.querySelector('.prose')).fontFamily.split(',')[0] },
  }));
}));
</script>`;

// Exercise the controls: change every preference through the form, then
// read back what was stored and applied; then reset.
const exercise = `<script>
addEventListener('load', () => {
  const pick = (name, value) => { const i = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); i.click(); };
  document.getElementById('appearance-toggle').click();
  pick('theme','dark'); pick('ink','sakura'); pick('read','serif'); pick('size','large'); pick('density','compact'); pick('motion','reduced');
  let stored; try { stored = localStorage.getItem('appearance'); } catch (e) { stored = 'THREW ' + e.name; }
  const applied = ['theme','ink','read','size','density','motion'].map((k) => document.documentElement.getAttribute('data-' + k)).join(',');
  const status1 = document.getElementById('appearance-status').textContent;
  document.getElementById('appearance-reset').click();
  let afterReset; try { afterReset = localStorage.getItem('appearance'); } catch (e) { afterReset = 'THREW ' + e.name; }
  const appliedReset = ['theme','ink','read','size','density','motion'].map((k) => document.documentElement.getAttribute('data-' + k)).join(',');
  // Escape closes and returns focus to the trigger.
  const tg = document.getElementById('appearance-toggle');
  if (tg.getAttribute('aria-expanded') !== 'true') tg.click();
  const wasOpen = tg.getAttribute('aria-expanded') === 'true';
  document.querySelector('input[name="ink"]:checked').focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const escClosed = document.getElementById('appearance-toggle').getAttribute('aria-expanded') === 'false';
  const focusBack = document.activeElement.id;
  console.log(JSON.stringify({ stored, applied, status1, afterReset, appliedReset, status2: document.getElementById('appearance-status').textContent, wasOpen, escClosed, focusBack }));
});
</script>`;

const pages = ['home', 'projects', 'about'];
const variants = {
  open: { head: clear, body: openPanel },
  audit: { head: clear, body: audit },
  exercise: { head: clear, body: exercise },
  deny: { head: deny, body: exercise },
  denyopen: { head: deny, body: openPanel },
  combo: { head: seed({ theme: 'light', ink: 'fuji', read: 'serif', size: 'large', density: 'compact', motion: 'reduced' }), body: audit },
  combo2: { head: seed({ theme: 'dark', ink: 'matcha', read: 'serif', size: 'large', density: 'comfortable', motion: 'system' }), body: audit },
  // WCAG 1.4.4: text at 200% (root font size doubled), checked for overflow.
  big: { head: '<style>:root:root{font-size:200%!important}</style>', body: audit },
  bigopen: { head: '<style>:root:root{font-size:200%!important}</style>', body: openPanel },
  // Tooltip: programmatic focus on the icon (no real keyboard available).
  tip: { head: clear, body: `<script>addEventListener('load',()=>document.fonts.ready.then(()=>{const t=document.getElementById('appearance-toggle');t.focus();setTimeout(()=>{const tip=document.getElementById('appearance-tip');const s=getComputedStyle(tip);console.log(JSON.stringify({focusVisible:t.matches(':focus-visible'),tipVisible:s.visibility,tipOpacity:s.opacity,label:tip.textContent,labelledby:t.getAttribute('aria-labelledby'),w:t.offsetWidth,h:t.offsetHeight}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));setTimeout(()=>{console.log('after Escape tip', getComputedStyle(tip).visibility)},200)},300)}));</script>` },
  // Tooltip shown for a capture: transitions off (the preview frame does not
  // advance CSS transitions reliably), focus kept, no Escape.
  tipshow: { head: clear + '<style>.tip{transition:none!important}</style>', body: `<script>addEventListener('load',()=>document.fonts.ready.then(()=>{const t=document.getElementById('appearance-toggle');t.focus();const s=getComputedStyle(document.getElementById('appearance-tip'));console.log(JSON.stringify({focusVisible:t.matches(':focus-visible'),vis:s.visibility,op:s.opacity}))}));</script>` },
  bogus: { head: `<script>try{localStorage.setItem('appearance','{"theme":"vellum","ink":"coral","size":9')}catch(e){}</script>`, body: audit },
};
for (const ink of ['ai', 'sakura', 'matcha', 'fuji', 'sora']) {
  for (const theme of ['light', 'dark']) {
    variants[`ink-${ink}-${theme}`] = { head: seed({ theme, ink }), body: audit };
  }
}

for (const page of pages) {
  const src = readFileSync(join(here, `${page}.html`), 'utf8');
  for (const [name, v] of Object.entries(variants)) {
    if (name.startsWith('ink-') && page !== 'home') continue;
    const html = src
      .replace('<head>', () => `<head>${v.head}`)
      .replace('</body>', () => `${v.body}</body>`);
    writeFileSync(join(out, `${page}.${name}.html`), html);
  }
}
console.log('wrote', out);
