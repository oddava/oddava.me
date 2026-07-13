import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTENT_KEYS,
  ancestorsOfDirectory,
  createRedisTransport,
  loadEnvironment,
  parentDirectory,
  resolveTarget,
  withContentLock,
} from './lib/redis-content.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_ROOTS = ['src/content/notes', 'public/images/notes'];
const MEDIA_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const arguments_ = process.argv.slice(2);
const dryRun = arguments_.includes('--dry-run');
const prune = arguments_.includes('--prune');
const targetArgument = arguments_
  .find((argument) => argument.startsWith('--target='))
  ?.split('=')[1];

function collectFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function gitDate(path, first) {
  try {
    const output = execFileSync(
      'git',
      first
        ? ['log', '--diff-filter=A', '--follow', '--format=%aI', '--', path]
        : ['log', '-1', '--format=%aI', '--', path],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    const dates = output.split(/\r?\n/).filter(Boolean);
    return (first ? dates.at(-1) : dates[0]) ?? '';
  } catch {
    return '';
  }
}

function loadRecords() {
  const timestamp = new Date().toISOString();
  return CONTENT_ROOTS.flatMap((root) =>
    collectFiles(join(projectRoot, root)).flatMap((absolutePath) => {
      const extension = extname(absolutePath).toLowerCase();
      const path = relative(projectRoot, absolutePath).replace(/\\/g, '/');
      const isText =
        path.startsWith('src/content/notes/') && extension === '.mdx';
      const isMedia =
        path.startsWith('public/images/notes/') &&
        MEDIA_EXTENSIONS.has(extension);
      if (!isText && !isMedia) return [];
      const bytes = readFileSync(absolutePath);
      const updatedAt = gitDate(absolutePath, false) || timestamp;
      const createdAt = gitDate(absolutePath, true) || updatedAt;
      return [
        {
          path,
          record: {
            content: isText ? bytes.toString('utf8') : bytes.toString('base64'),
            enc: isText ? 'utf8' : 'base64',
            rev: `r${randomUUID().replaceAll('-', '')}`,
            createdAt,
            updatedAt,
          },
        },
      ];
    }),
  ).sort((left, right) => left.path.localeCompare(right.path));
}

function managedPath(path) {
  const extension = extname(path).toLowerCase();
  return (
    (path.startsWith('src/content/notes/') && extension === '.mdx') ||
    (path.startsWith('public/images/notes/') && MEDIA_EXTENSIONS.has(extension))
  );
}

function managedDirectory(path) {
  return CONTENT_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

async function snapshotManagedStore(transport) {
  const filePaths = (
    (await transport.command(['SMEMBERS', CONTENT_KEYS.files])) ?? []
  ).filter(managedPath);
  const records = new Map();
  for (let offset = 0; offset < filePaths.length; offset += 100) {
    const batch = filePaths.slice(offset, offset + 100);
    const values = await transport.command([
      'MGET',
      ...batch.map((path) => CONTENT_KEYS.file(path)),
    ]);
    for (const [index, path] of batch.entries()) {
      records.set(path, values[index] ?? null);
    }
  }
  const directories = new Set(
    (
      (await transport.command(['SMEMBERS', CONTENT_KEYS.directories])) ?? []
    ).filter(managedDirectory),
  );
  return { filePaths: new Set(filePaths), records, directories };
}

async function restoreManagedStore(transport, snapshot, importedPaths) {
  for (const path of importedPaths) {
    if (snapshot.filePaths.has(path)) continue;
    await transport.command(['DEL', CONTENT_KEYS.file(path)]);
    await transport.command(['SREM', CONTENT_KEYS.files, path]);
  }
  const currentPaths = (
    (await transport.command(['SMEMBERS', CONTENT_KEYS.files])) ?? []
  ).filter(managedPath);
  for (const path of currentPaths) {
    if (snapshot.filePaths.has(path)) continue;
    await transport.command(['DEL', CONTENT_KEYS.file(path)]);
    await transport.command(['SREM', CONTENT_KEYS.files, path]);
  }
  for (const path of snapshot.filePaths) {
    const record = snapshot.records.get(path);
    if (typeof record === 'string') {
      await transport.command(['SET', CONTENT_KEYS.file(path), record]);
    } else {
      await transport.command(['DEL', CONTENT_KEYS.file(path)]);
    }
    await transport.command(['SADD', CONTENT_KEYS.files, path]);
  }

  const currentDirectories = (
    (await transport.command(['SMEMBERS', CONTENT_KEYS.directories])) ?? []
  ).filter(managedDirectory);
  for (const directory of currentDirectories) {
    if (snapshot.directories.has(directory)) continue;
    await transport.command(['SREM', CONTENT_KEYS.directories, directory]);
  }
  for (const directory of snapshot.directories) {
    await transport.command(['SADD', CONTENT_KEYS.directories, directory]);
  }
}

async function main() {
  const environment = loadEnvironment(projectRoot);
  const target = resolveTarget(environment, targetArgument);
  const records = loadRecords();
  if (records.length === 0) {
    throw new Error('No notes or note media were found to import.');
  }
  const notePaths = records
    .map(({ path }) => path)
    .filter((path) => path.startsWith('src/content/notes/'));
  if (!notePaths.includes('src/content/notes/index.mdx')) {
    throw new Error('The notes import requires src/content/notes/index.mdx.');
  }
  const notePathById = new Map();
  for (const path of notePaths) {
    const id = basename(path, '.mdx');
    const existing = notePathById.get(id);
    if (existing) {
      throw new Error(
        `Duplicate note id "${id}" in ${existing} and ${path}. Studio ids must be unique.`,
      );
    }
    notePathById.set(id, path);
  }

  const directories = new Set(
    records.flatMap(({ path }) => ancestorsOfDirectory(parentDirectory(path))),
  );
  console.info(
    `Target: ${target} · files: ${records.length} · directories: ${directories.size}${dryRun ? ' · DRY RUN' : ''}`,
  );
  for (const { path } of records) console.info(`  import ${path}`);
  if (dryRun) return;

  const transport = await createRedisTransport(target, environment);
  try {
    await withContentLock(transport, async () => {
      const snapshot = await snapshotManagedStore(transport);
      // Advance the version before touching data. The lock hides the in-flight
      // state; if the process or transport fails, readers will still reject
      // their old cached version after the lock expires.
      await transport.command(['INCR', CONTENT_KEYS.version]);
      try {
        for (const { path, record } of records) {
          await transport.command([
            'SET',
            CONTENT_KEYS.file(path),
            JSON.stringify(record),
          ]);
          await transport.command(['SADD', CONTENT_KEYS.files, path]);
        }
        for (const directory of directories) {
          await transport.command([
            'SADD',
            CONTENT_KEYS.directories,
            directory,
          ]);
        }

        if (prune) {
          const imported = new Set(records.map(({ path }) => path));
          const existingFiles =
            (await transport.command(['SMEMBERS', CONTENT_KEYS.files])) ?? [];
          for (const path of existingFiles) {
            if (!managedPath(path) || imported.has(path)) continue;
            await transport.command(['DEL', CONTENT_KEYS.file(path)]);
            await transport.command(['SREM', CONTENT_KEYS.files, path]);
            console.info(`  prune ${path}`);
          }

          const existingDirectories =
            (await transport.command(['SMEMBERS', CONTENT_KEYS.directories])) ??
            [];
          for (const directory of existingDirectories) {
            if (!managedDirectory(directory)) continue;
            if (directories.has(directory)) continue;
            await transport.command([
              'SREM',
              CONTENT_KEYS.directories,
              directory,
            ]);
          }
        }
      } catch (error) {
        await restoreManagedStore(
          transport,
          snapshot,
          records.map(({ path }) => path),
        ).catch((rollbackError) => {
          console.error(
            `[content-sync] Import rollback failed: ${rollbackError.message}`,
          );
        });
        throw error;
      }
    });
    console.info('Done. Redis content is live.');
  } finally {
    await transport.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
