// Seed the Redis content store from the note files in the repo.
//
// Run this once (per target) so the live site has notes to read after the
// switch to the runtime store. It is also the "restore from git backup" path:
// export-notes-from-redis.mjs writes the store back to these files, and this
// re-imports them.
//
//   node scripts/migrate-notes-to-redis.mjs                 # local (dev redis)
//   node scripts/migrate-notes-to-redis.mjs --target=prod   # Upstash
//   node scripts/migrate-notes-to-redis.mjs --dry-run
//
// Existing keys for a note path are overwritten; notes only in the store (not
// on disk) are left untouched unless --prune is passed.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEYS,
  ancestorsOfDir,
  createTransport,
  loadEnvFile,
  parentDir,
  resolveTarget,
} from './lib/redis-cli.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_DIR = join(projectRoot, 'src', 'content', 'notes');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const prune = args.includes('--prune');
const targetArg = args
  .find((arg) => arg.startsWith('--target='))
  ?.split('=')[1];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.mdx')) out.push(full);
  }
  return out;
}

function gitDate(absolutePath, first) {
  try {
    const format = '--format=%aI';
    const out = execFileSync(
      'git',
      first
        ? ['log', '--diff-filter=A', '--follow', format, '--', absolutePath]
        : ['log', '-1', format, '--', absolutePath],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    const lines = out.split(/\r?\n/).filter(Boolean);
    return (first ? lines[lines.length - 1] : lines[0]) ?? '';
  } catch {
    return '';
  }
}

async function main() {
  const env = loadEnvFile(projectRoot);
  const target = resolveTarget(env, targetArg);
  const files = walk(NOTES_DIR).sort();
  if (files.length === 0) {
    console.error('No note files found under src/content/notes.');
    process.exit(1);
  }

  const now = new Date().toISOString();
  const filePaths = [];
  const dirSet = new Set();
  const records = [];

  files.forEach((absolutePath, index) => {
    const repoPath = relative(projectRoot, absolutePath).replace(/\\/g, '/');
    const content = readFileSync(absolutePath, 'utf8');
    const updatedAt = gitDate(absolutePath, false) || now;
    const createdAt = gitDate(absolutePath, true) || updatedAt;
    const record = {
      content,
      enc: 'utf8',
      rev: `redis:${index + 1}`,
      createdAt,
      updatedAt,
    };
    records.push({ repoPath, record });
    filePaths.push(repoPath);
    for (const dir of ancestorsOfDir(parentDir(repoPath))) dirSet.add(dir);
  });

  console.log(
    `Target: ${target}  ·  notes: ${records.length}  ·  dirs: ${dirSet.size}` +
      (dryRun ? '  ·  DRY RUN' : ''),
  );
  for (const { repoPath } of records) console.log(`  note  ${repoPath}`);
  if (dryRun) return;

  const redis = await createTransport(target, env);
  try {
    for (const { repoPath, record } of records) {
      await redis.command(['SET', KEYS.file(repoPath), JSON.stringify(record)]);
      await redis.command(['SADD', KEYS.files, repoPath]);
    }
    for (const dir of dirSet) {
      await redis.command(['SADD', KEYS.dirs, dir]);
    }
    // Bump the version so any warm reader rebuilds its cached index.
    await redis.command(['INCR', KEYS.version]);

    if (prune) {
      const existing = (await redis.command(['SMEMBERS', KEYS.files])) ?? [];
      const keep = new Set(filePaths);
      for (const path of existing) {
        if (path.startsWith('src/content/notes/') && !keep.has(path)) {
          await redis.command(['DEL', KEYS.file(path)]);
          await redis.command(['SREM', KEYS.files, path]);
          console.log(`  prune ${path}`);
        }
      }
    }
    console.log('Done. Notes are live in the store.');
  } finally {
    await redis.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
