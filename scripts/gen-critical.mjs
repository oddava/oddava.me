// Generates src/styles/critical.css by concatenating design-system partials.
// Run via `pnpm run gen:critical` (wired into `dev` and `build`).
// Partials: _fonts.css + _variables.css + _reset.css + _typography.css
// Skips the write when content is unchanged so Vite does not invalidate caches.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stylesDir = resolve(__dirname, '..', 'src', 'styles');
const outputPath = resolve(stylesDir, 'critical.css');

const partials = [
  '_fonts.css',
  '_variables.css',
  '_reset.css',
  '_typography.css',
];

const sections = await Promise.all(
  partials.map(async (name) => {
    const content = await readFile(resolve(stylesDir, name), 'utf8');
    return `/* === ${name} === */\n${content.trim()}`;
  }),
);

const output = `${sections.join('\n\n')}\n`;

let previous = null;
try {
  previous = await readFile(outputPath, 'utf8');
} catch {
  /* First run — file may not exist yet. */
}

if (previous === output) {
  console.log(
    `critical.css unchanged (${output.length} bytes) from ${partials.join(', ')}`,
  );
} else {
  await writeFile(outputPath, output, 'utf8');
  console.log(
    `critical.css regenerated (${output.length} bytes) from ${partials.join(', ')}`,
  );
}
