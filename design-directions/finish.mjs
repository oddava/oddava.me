import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const sharp = (
  await import(
    process.env.SHARP_MODULE
      ? pathToFileURL(process.env.SHARP_MODULE).href
      : 'sharp'
  )
).default;
const results = JSON.parse(
  readFileSync(resolve(dir, 'renderer-qa.json'), 'utf8'),
);
assert.equal(results.length, 12);
const summaries = [];
const images = {};
for (const r of results) {
  const record = r.consoleMessages.find((m) =>
    m.text.startsWith('ODDAVA_RESULT '),
  );
  assert(record, r.name + ': renderer checks did not finish');
  const result = JSON.parse(record.text.slice('ODDAVA_RESULT '.length));
  assert.deepEqual(result.errors, [], r.name + ': renderer failures');
  assert(
    !r.consoleMessages.some((m) => ['error', 'warn'].includes(m.level)),
    r.name + ': console',
  );
  const mode = r.width === 1440 ? 'desktop' : 'mobile';
  const height = mode === 'desktop' ? 1000 : 844;
  const raw = resolve(dir, 'screenshots', `${r.name}-${mode}-full.png`);
  const crop = resolve(dir, 'screenshots', `${r.name}-${mode}.png`);
  const metadata = await sharp(raw).metadata();
  assert.equal(metadata.width, r.width);
  assert.equal(metadata.height, r.capturedHeight);
  assert(metadata.height >= height);
  await sharp(raw)
    .extract({ left: 0, top: 0, width: r.width, height })
    .png()
    .toFile(crop);
  const cropMeta = await sharp(crop).metadata();
  assert.equal(cropMeta.height, height);
  images[`${r.name}-${mode}`] = crop;
  summaries.push({
    file: `${r.name}.html`,
    width: r.width,
    rawHeight: r.capturedHeight,
    cropHeight: height,
    checks: result.checks,
    errors: result.errors,
    storage: result.storage,
    networkAssets: result.networkAssets,
    minimumContrast: JSON.parse(
      r.consoleMessages
        .find((m) => m.text.startsWith('ODDAVA_CONTRAST '))
        .text.slice('ODDAVA_CONTRAST '.length),
    ),
  });
}
writeFileSync(
  resolve(dir, 'qa-summary.json'),
  JSON.stringify(summaries, null, 2),
);
const names = ['margin', 'parts', 'atlas'];
const meta = [
  [
    'Margin',
    'Reading first',
    'A notebook already open on a useful page.',
    'Best if reading is the main reason to visit.',
  ],
  [
    'Parts Desk',
    'Work first',
    'A project directory, a real system, then loose files.',
    'Best if engineering work is the first priority.',
  ],
  [
    'Walking Index',
    'Explore the person',
    'Work, reading and diary as stops on one route.',
    'Recommended for the strongest personal identity.',
  ],
];
const font = readFileSync(
  resolve(dir, 'fonts/PublicSans-variable.ttf'),
).toString('base64');
const cards = await Promise.all(
  names.map(async (name, i) => {
    const home = (
      await sharp(images[`${name}-home-desktop`])
        .resize({ width: 600 })
        .png()
        .toBuffer()
    ).toString('base64');
    const note = (
      await sharp(images[`${name}-note-desktop`])
        .resize({ width: 600 })
        .png()
        .toBuffer()
    ).toString('base64');
    return `<article><span class="number">0${i + 1} / ${meta[i][1]}</span><h2>${meta[i][0]}</h2><p>${meta[i][2]}</p><a class="shot" href="${name}-home.html"><img width="600" height="417" src="data:image/png;base64,${home}" alt="${meta[i][0]} home, desktop top crop"></a><div class="links"><a href="${name}-home.html">Open home →</a><a href="${name}-note.html">Read inner →</a></div><a class="shot inner" href="${name}-note.html"><img width="600" height="417" src="data:image/png;base64,${note}" alt="${meta[i][0]} reading page, desktop top crop"></a><p class="decision">${meta[i][3]}</p></article>`;
  }),
);
writeFileSync(
  resolve(dir, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>oddava — three design directions</title><style>@font-face{font-family:PublicSans;src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:100 900;font-display:block}*{box-sizing:border-box}body{margin:0;padding:0;font-family:PublicSans,Arial,sans-serif;color:var(--foreground,#182a40);background:transparent;line-height:1.5}main{max-width:1250px;margin:auto}header{padding:12px 0 24px}h1{font-size:clamp(28px,4vw,46px);letter-spacing:-.05em;line-height:1.1;margin:12px 0}header p{font-size:14px;max-width:700px;color:var(--muted-foreground,#52617a)}.eyebrow,.number{font-size:10px;text-transform:uppercase;letter-spacing:.08em}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}article{padding:16px;border-radius:var(--radius,8px);background:var(--card,#f1f5f9);border:1px solid var(--border,#bdc9d7)}h2{font-size:24px;letter-spacing:-.04em;margin:12px 0 7px}article p{font-size:12px;min-height:38px;margin:0 0 16px}a{color:inherit}a:focus-visible{outline:3px solid #2451c4;outline-offset:4px}.shot{display:block;border:1px solid var(--border,#bdc9d7);overflow:hidden}.shot img{display:block;width:100%;height:auto}.links{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:11px;margin:15px 0}.decision{margin:16px 0 0!important;font-size:11px!important;min-height:0!important}.notes{font-size:12px;margin:22px 0;padding-bottom:20px}.notes a{margin-right:18px}@media(max-width:600px){.grid{grid-template-columns:1fr}article p{min-height:0}.shot{max-width:600px}}</style></head><body><main><header><span class="eyebrow">oddava / design selection package / local only</span><h1>Three structures.<br>One actual person.</h1><p>Six standalone mockups, built around the same real projects and reading note. Choose the browsing model before choosing the finish.</p></header><div class="grid">${cards.join('')}</div><div class="notes"><p>Images are top crops of sanctioned, full-document HTML renders. Each mockup has embedded free fonts and six working visitor preferences. No production website was rebuilt.</p><a href="directions.md">Design rationale</a><a href="content-inventory.md">Content evidence</a><a href="QA.md">QA and limits</a><a href="screenshots/README.md">All 12 screenshot paths</a></div></main></body></html>`,
);
for (const [mode, tileWidth, tileHeight, columns] of [
  ['desktop', 600, 417, 3],
  ['mobile', 260, 563, 6],
]) {
  const files =
    mode === 'desktop'
      ? [
          'margin-home',
          'parts-home',
          'atlas-home',
          'margin-note',
          'parts-note',
          'atlas-note',
        ]
      : [
          'margin-home',
          'margin-note',
          'parts-home',
          'parts-note',
          'atlas-home',
          'atlas-note',
        ];
  const tiles = await Promise.all(
    files.map(async (name, i) => ({
      input: await sharp(images[`${name}-${mode}`])
        .resize(tileWidth, tileHeight)
        .png()
        .toBuffer(),
      left: (i % columns) * tileWidth,
      top: Math.floor(i / columns) * tileHeight,
    })),
  );
  await sharp({
    create: {
      width: tileWidth * columns,
      height: tileHeight * Math.ceil(files.length / columns),
      channels: 4,
      background: '#ffffff',
    },
  })
    .composite(tiles)
    .png()
    .toFile(resolve(dir, 'screenshots', `${mode}-contact-sheet.png`));
}
console.log(
  'Verified 12 renderer results; saved 12 exact-size top crops, comparison and contact sheets.',
);
