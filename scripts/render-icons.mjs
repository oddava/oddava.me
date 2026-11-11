/**
 * The site mark, for now: a plain lowercase "o" on the dark tile. A stand-in
 * until the Rubric mark replaces it.
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

const INK = '#adcaff';
const TILE = '#000000';
// A round "o": a ring on a 32-unit grid, even-odd filled.
const O =
  'M16 8.5a7.5 7.5 0 1 0 0 15a7.5 7.5 0 1 0 0-15Zm0 3.2a4.3 4.3 0 1 1 0 8.6a4.3 4.3 0 1 1 0-8.6Z';
const mark = `<path fill="${INK}" fill-rule="evenodd" d="${O}"/>`;

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>
`;

const favicon = svg(
  `<rect width="32" height="32" rx="7.5" fill="${TILE}"/>${mark}`,
);
// Full-bleed for platforms that cut their own shape. `scale` keeps maskable
// icons inside the 80% safe zone.
const square = (scale = 1) =>
  svg(
    `<rect width="32" height="32" fill="${TILE}"/>` +
      `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${mark}</g>`,
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
