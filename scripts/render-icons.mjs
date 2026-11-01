/**
 * The site mark: an odd-eyed black cat in the dark. The tile is the night and
 * the cat is black on black, so all of it you see is two eyes — one
 * --color-brand, one --color-text-interactive-hover, the blues of the
 * homepage cat's iris. Heterochromia in cats is called "odd eyes".
 *
 * Every icon in public/ is written from the geometry below; rerun with
 * `pnpm run icons` after changing it.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
);

// A 32-unit grid, so 2 units are one pixel at 16 and every vertical edge that
// matters lands on a pixel boundary at 16 and 32. This is the right eye; the
// left mirrors it. Inner corner low and pointed, outer corner round.
const EYE =
  'M18 18C19.6 14.6 22.4 13 25 13C27 13 28 14.8 28 16.8C28 19.4 25.8 21 23.4 21C21.2 21 19.4 19.9 18 18Z';
// Tab sizes: straight-sided through the middle, exactly one pixel column at
// 16px, so the slit stays a crisp black line instead of a grey smear.
const TAB_SLIT =
  'M23 13.6C23.8 14.6 24 15.6 24 16.6V17.6C24 18.6 23.8 19.6 23 20.6C22.2 19.6 22 18.6 22 17.6V16.6C22 15.6 22.2 14.6 23 13.6Z';
// Large sizes have the pixels for a true tapered slit.
const LARGE_SLIT =
  'M23 13.4C24.3 15.4 24.3 18.8 23 20.8C21.7 18.8 21.7 15.4 23 13.4Z';
const BRAND = '#7aa7ff';
const LIGHT = '#d6e4ff';
const NIGHT = '#000000';
const MIRROR = 'matrix(-1 0 0 1 32 0)';

const eyes = (slit) =>
  `<path fill="${BRAND}" d="${EYE}" transform="${MIRROR}"/>` +
  `<path fill="${LIGHT}" d="${EYE}"/>` +
  `<path fill="${NIGHT}" d="${slit}" transform="${MIRROR}"/>` +
  `<path fill="${NIGHT}" d="${slit}"/>`;

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>\n`;

// The rounded tile is part of the mark: the eyes need the dark on a light tab.
const favicon = svg(
  `<rect width="32" height="32" rx="7.5" fill="${NIGHT}"/>${eyes(TAB_SLIT)}`,
);
// Full-bleed for platforms that cut their own shape. `scale` keeps maskable
// icons inside the 80% safe zone.
const square = (scale = 1) =>
  svg(
    `<rect width="32" height="32" fill="${NIGHT}"/>` +
      `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${eyes(LARGE_SLIT)}</g>`,
  );

const png = (source, size) =>
  sharp(Buffer.from(source), { density: (72 * size) / 32 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

/** An ICO of PNG frames; every browser that still asks for one reads these. */
function ico(frames) {
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...frames.map((frame) => frame.data)]);
}

const frames = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, data: await png(favicon, size) })),
);
const outputs = {
  'favicon.svg': favicon,
  'favicon.ico': ico(frames),
  'apple-touch-icon.png': await png(square(), 180),
  'icon-192.png': await png(square(), 192),
  'icon-512.png': await png(square(), 512),
  'icon-maskable-512.png': await png(square(0.8), 512),
};
for (const [name, data] of Object.entries(outputs)) {
  await writeFile(path.join(publicRoot, name), data);
}
console.log(`Wrote ${Object.keys(outputs).join(', ')} to public/.`);
