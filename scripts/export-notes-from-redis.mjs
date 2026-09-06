import {
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTENT_KEYS,
  assertKnownArgs,
  createRedisTransport,
  loadEnvironment,
  resolveTarget,
  withContentLock,
} from './lib/redis-content.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_ROOTS = ['src/content/notes', 'public/images/notes'];
const MEDIA_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
// Export mirrors the store, which may still hold legacy `.mdx` keys.
const NOTE_EXTENSIONS = new Set(['.md', '.mdx']);
const arguments_ = process.argv.slice(2);
assertKnownArgs(arguments_, ['--dry-run', '--keep-removed', '--target']);
const dryRun = arguments_.includes('--dry-run');
const keepRemoved = arguments_.includes('--keep-removed');
const targetArgument = arguments_
  .find((argument) => argument.startsWith('--target='))
  ?.split('=')[1];

function managedPath(path) {
  const extension = extname(path).toLowerCase();
  return (
    (path.startsWith('src/content/notes/') && NOTE_EXTENSIONS.has(extension)) ||
    (path.startsWith('public/images/notes/') && MEDIA_EXTENSIONS.has(extension))
  );
}

function safeAbsolutePath(repositoryPath) {
  if (
    !repositoryPath ||
    repositoryPath.includes('\\') ||
    repositoryPath
      .split('/')
      .some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe content path in Redis: ${repositoryPath}`);
  }
  const absolutePath = resolve(projectRoot, ...repositoryPath.split('/'));
  const root = resolve(projectRoot);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    throw new Error(`Unsafe content path in Redis: ${repositoryPath}`);
  }
  let current = root;
  for (const segment of repositoryPath.split('/')) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(
          `Unsafe symbolic link in content path: ${repositoryPath}`,
        );
      }
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }
  return absolutePath;
}

function collectExistingFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectExistingFiles(absolutePath));
    else if (entry.isFile()) {
      files.push(relative(projectRoot, absolutePath).replace(/\\/g, '/'));
    }
  }
  return files;
}

function writeAtomically(path, content) {
  const absolutePath = safeAbsolutePath(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' });
    renameSync(temporaryPath, absolutePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function decodeRecord(path, raw) {
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON for ${path}.`);
  }
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.content !== 'string'
  ) {
    throw new Error(`Invalid content record for ${path}.`);
  }
  if (record.enc === 'utf8' && path.startsWith('src/content/notes/')) {
    return record.content;
  }
  if (record.enc === 'base64' && path.startsWith('public/images/notes/')) {
    const bytes = Buffer.from(record.content, 'base64');
    if (bytes.toString('base64') !== record.content) {
      throw new Error(`Invalid base64 content for ${path}.`);
    }
    return bytes;
  }
  throw new Error(`Invalid content record for ${path}.`);
}

async function main() {
  const environment = loadEnvironment(projectRoot);
  const target = resolveTarget(environment, targetArgument);
  const transport = await createRedisTransport(target, environment);
  try {
    await withContentLock(transport, async () => {
      const allPaths = await transport.command([
        'SMEMBERS',
        CONTENT_KEYS.files,
      ]);
      if (
        !Array.isArray(allPaths) ||
        allPaths.some((path) => typeof path !== 'string')
      ) {
        throw new Error('Redis returned an invalid content file listing.');
      }
      const paths = allPaths.filter(managedPath).sort();
      if (
        !paths.some((path) => /^src\/content\/notes\/index\.mdx?$/.test(path))
      ) {
        throw new Error(
          'The store has no root index note. Refusing to replace the repository backup.',
        );
      }
      // Fully validate the snapshot before changing the backup. A missing
      // record is corruption or an incomplete read, never evidence of deletion.
      const snapshot = new Map();
      for (let offset = 0; offset < paths.length; offset += 100) {
        const batch = paths.slice(offset, offset + 100);
        const records = await transport.command([
          'MGET',
          ...batch.map(CONTENT_KEYS.file),
        ]);
        if (!Array.isArray(records) || records.length !== batch.length) {
          throw new Error('Redis returned an incomplete content snapshot.');
        }
        for (const [index, path] of batch.entries()) {
          safeAbsolutePath(path);
          if (typeof records[index] !== 'string') {
            throw new Error(
              `Missing content record for ${path}. Refusing to change the repository backup.`,
            );
          }
          snapshot.set(path, decodeRecord(path, records[index]));
        }
      }
      const removed = [];
      if (!keepRemoved) {
        for (const root of CONTENT_ROOTS) {
          const absoluteRoot = safeAbsolutePath(root);
          for (const path of collectExistingFiles(absoluteRoot)) {
            if (!managedPath(path) || snapshot.has(path)) continue;
            safeAbsolutePath(path);
            removed.push(path);
          }
        }
      }
      console.info(
        `Target: ${target} · files: ${paths.length}${dryRun ? ' · DRY RUN' : ''}`,
      );

      for (const [path, content] of snapshot) {
        console.info(`  export ${path}`);
        if (!dryRun) writeAtomically(path, content);
      }

      for (const path of removed) {
        console.info(`  remove ${path}`);
        if (!dryRun) rmSync(safeAbsolutePath(path), { force: true });
      }
    });
    console.info('Done. Repository content matches Redis.');
  } finally {
    await transport.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
