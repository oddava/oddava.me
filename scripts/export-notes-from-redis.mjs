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
  } catch {
    return files;
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
  if (record.enc === 'utf8' && typeof record.content === 'string') {
    return record.content;
  }
  if (record.enc === 'base64' && typeof record.content === 'string') {
    return Buffer.from(record.content, 'base64');
  }
  throw new Error(`Invalid content record for ${path}.`);
}

async function main() {
  const environment = loadEnvironment(projectRoot);
  const target = resolveTarget(environment, targetArgument);
  const transport = await createRedisTransport(target, environment);
  try {
    await withContentLock(transport, async () => {
      const allPaths =
        (await transport.command(['SMEMBERS', CONTENT_KEYS.files])) ?? [];
      const paths = allPaths.filter(managedPath).sort();
      const rawRecords = paths.length
        ? await transport.command([
            'MGET',
            ...paths.map((path) => CONTENT_KEYS.file(path)),
          ])
        : [];
      console.info(
        `Target: ${target} · files: ${paths.length}${dryRun ? ' · DRY RUN' : ''}`,
      );

      const exported = new Set();
      for (const [index, path] of paths.entries()) {
        safeAbsolutePath(path);
        const raw = rawRecords[index];
        if (typeof raw !== 'string') continue;
        const content = decodeRecord(path, raw);
        exported.add(path);
        console.info(`  export ${path}`);
        if (!dryRun) writeAtomically(path, content);
      }

      if (!keepRemoved) {
        for (const root of CONTENT_ROOTS) {
          for (const path of collectExistingFiles(join(projectRoot, root))) {
            if (!managedPath(path)) continue;
            if (exported.has(path)) continue;
            console.info(`  remove ${path}`);
            if (!dryRun) rmSync(safeAbsolutePath(path), { force: true });
          }
        }
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
