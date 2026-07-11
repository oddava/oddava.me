// Snapshot the Redis content store back to note files on disk — the git backup
// path for the runtime store. Run it whenever you want the repo to reflect
// what Studio has published, then commit the result.
//
//   node scripts/export-notes-from-redis.mjs                # local (dev redis)
//   node scripts/export-notes-from-redis.mjs --target=prod  # Upstash
//   node scripts/export-notes-from-redis.mjs --dry-run
//
// Only note files (src/content/notes/**.mdx) are written. Files on disk that
// are no longer in the store are deleted unless --keep-removed is passed.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEYS,
  createTransport,
  loadEnvFile,
  resolveTarget,
} from './lib/redis-cli.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_PREFIX = 'src/content/notes/';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keepRemoved = args.includes('--keep-removed');
const targetArg = args
  .find((arg) => arg.startsWith('--target='))
  ?.split('=')[1];

function existingNoteFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...existingNoteFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      out.push(relative(projectRoot, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

async function main() {
  const env = loadEnvFile(projectRoot);
  const target = resolveTarget(env, targetArg);
  const redis = await createTransport(target, env);

  try {
    const allPaths = (await redis.command(['SMEMBERS', KEYS.files])) ?? [];
    const notePaths = allPaths
      .filter((path) => path.startsWith(NOTES_PREFIX) && path.endsWith('.mdx'))
      .sort();

    console.log(
      `Target: ${target}  ·  notes in store: ${notePaths.length}` +
        (dryRun ? '  ·  DRY RUN' : ''),
    );

    const written = new Set();
    for (const path of notePaths) {
      const raw = await redis.command(['GET', KEYS.file(path)]);
      if (!raw) continue;
      const record = JSON.parse(raw);
      if (record.enc !== 'utf8') continue;
      written.add(path);
      console.log(`  write ${path}`);
      if (dryRun) continue;
      const absolute = join(projectRoot, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, record.content, 'utf8');
    }

    if (!keepRemoved) {
      for (const path of existingNoteFiles(
        join(projectRoot, 'src/content/notes'),
      )) {
        if (!written.has(path)) {
          console.log(`  remove ${path}`);
          if (!dryRun) rmSync(join(projectRoot, path), { force: true });
        }
      }
    }
    console.log('Done.');
  } finally {
    await redis.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
