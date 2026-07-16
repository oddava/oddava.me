import { createHash } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { assertSafeRepositoryPath, matchesExtension } from './paths';
import { ContentConflictError, ContentFolderNotEmptyError } from './types';
import type {
  ContentEncoding,
  ContentProvider,
  ContentSourceFile,
  ContentWriteResult,
  LinkedFileDelete,
  LinkedFileMove,
} from './types';

const TEXT_EXTENSIONS = new Set(['.md', '.mdx', '.json', '.yaml', '.yml']);

function result(message: string, revision?: string): ContentWriteResult {
  return { message, revision };
}

function revisionFor(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function resolveRepositoryPath(projectRoot: string, repositoryPath: string) {
  assertSafeRepositoryPath(repositoryPath);
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, ...repositoryPath.split('/'));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Unsafe content path.');
  }
  return target;
}

async function resolveSafeRepositoryPath(
  projectRoot: string,
  repositoryPath: string,
): Promise<string> {
  const target = resolveRepositoryPath(projectRoot, repositoryPath);
  const relative = path.relative(path.resolve(projectRoot), target);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = path.resolve(projectRoot);

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error('Unsafe content path: symbolic links are not allowed.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }

  return target;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function collectFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function collectDirectories(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    directories.push(target, ...(await collectDirectories(target)));
  }
  return directories;
}

async function readSourceFile(
  projectRoot: string,
  repositoryPath: string,
): Promise<ContentSourceFile | null> {
  const target = await resolveSafeRepositoryPath(projectRoot, repositoryPath);
  try {
    const fileStat = await lstat(target);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return null;
    const bytes = await readFile(target);
    const encoding: ContentEncoding = TEXT_EXTENSIONS.has(
      path.extname(target).toLowerCase(),
    )
      ? 'utf8'
      : 'base64';
    return {
      path: repositoryPath.replace(/\\/g, '/'),
      content: bytes.toString(encoding),
      encoding,
      byteLength: bytes.byteLength,
      updatedAt: fileStat.mtime.toISOString(),
      revision: revisionFor(bytes),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function assertRevision(
  projectRoot: string,
  repositoryPath: string,
  expected: string,
): Promise<ContentSourceFile> {
  const current = await readSourceFile(projectRoot, repositoryPath);
  if (!current || current.revision !== expected) {
    throw new ContentConflictError('revision_conflict');
  }
  return current;
}

async function assertDestinationAvailable(target: string): Promise<void> {
  if (await pathExists(target)) throw new ContentConflictError('path_exists');
}

export function createLocalContentProvider(
  projectRoot: string,
): ContentProvider {
  const normalizedRoot = path.resolve(projectRoot);
  let mutationQueue: Promise<void> = Promise.resolve();

  function runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = mutationQueue.then(operation);
    mutationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  return {
    async listFiles(directory, extension) {
      const absoluteDirectory = await resolveSafeRepositoryPath(
        normalizedRoot,
        directory,
      );
      const absoluteFiles = (await collectFiles(absoluteDirectory)).filter(
        (file) => matchesExtension(file, extension),
      );
      const files = await Promise.all(
        absoluteFiles.map((file) =>
          readSourceFile(
            normalizedRoot,
            path.relative(normalizedRoot, file).replace(/\\/g, '/'),
          ),
        ),
      );
      return files.filter((file): file is ContentSourceFile => file !== null);
    },

    readFile(repositoryPath) {
      return readSourceFile(normalizedRoot, repositoryPath);
    },

    async listDirectories(directory) {
      const absoluteDirectory = await resolveSafeRepositoryPath(
        normalizedRoot,
        directory,
      );
      return (await collectDirectories(absoluteDirectory)).map((entry) =>
        path.relative(normalizedRoot, entry).replace(/\\/g, '/'),
      );
    },

    createDirectory(repositoryPath, message) {
      return runMutation(async () => {
        await mkdir(
          await resolveSafeRepositoryPath(normalizedRoot, repositoryPath),
          {
            recursive: true,
          },
        );
        return result(message);
      });
    },

    moveFile(from, to, message, revision) {
      return runMutation(async () => {
        const source = await resolveSafeRepositoryPath(normalizedRoot, from);
        const destination = await resolveSafeRepositoryPath(normalizedRoot, to);
        await assertRevision(normalizedRoot, from, revision);
        await assertDestinationAvailable(destination);
        await mkdir(path.dirname(destination), { recursive: true });
        await assertRevision(normalizedRoot, from, revision);
        await assertDestinationAvailable(destination);
        await rename(source, destination);
        const moved = await readSourceFile(normalizedRoot, to);
        return result(message, moved?.revision);
      });
    },

    moveDirectory(
      from: string,
      to: string,
      message: string,
      linkedFile?: LinkedFileMove,
    ) {
      return runMutation(async () => {
        const source = await resolveSafeRepositoryPath(normalizedRoot, from);
        const destination = await resolveSafeRepositoryPath(normalizedRoot, to);
        await assertDestinationAvailable(destination);
        let linkedDestination: string | undefined;
        if (linkedFile) {
          await assertRevision(
            normalizedRoot,
            linkedFile.from,
            linkedFile.revision,
          );
          linkedDestination = await resolveSafeRepositoryPath(
            normalizedRoot,
            linkedFile.to,
          );
          await assertDestinationAvailable(linkedDestination);
        }
        await mkdir(path.dirname(destination), { recursive: true });
        await assertDestinationAvailable(destination);
        if (linkedFile && linkedDestination) {
          await assertRevision(
            normalizedRoot,
            linkedFile.from,
            linkedFile.revision,
          );
          await assertDestinationAvailable(linkedDestination);
        }
        await rename(source, destination);
        if (linkedFile && linkedDestination) {
          try {
            await mkdir(path.dirname(linkedDestination), { recursive: true });
            await rename(
              await resolveSafeRepositoryPath(normalizedRoot, linkedFile.from),
              linkedDestination,
            );
          } catch (error) {
            await rename(destination, source).catch(() => undefined);
            throw error;
          }
        }
        return result(message);
      });
    },

    deleteDirectory(
      repositoryPath: string,
      message: string,
      linkedFile?: LinkedFileDelete,
    ) {
      return runMutation(async () => {
        const target = await resolveSafeRepositoryPath(
          normalizedRoot,
          repositoryPath,
        );
        if ((await collectFiles(target)).length > 0) {
          throw new ContentFolderNotEmptyError();
        }
        if (linkedFile) {
          await assertRevision(
            normalizedRoot,
            linkedFile.path,
            linkedFile.revision,
          );
        }
        await rm(target, { recursive: true });
        if (linkedFile) {
          try {
            await unlink(
              await resolveSafeRepositoryPath(normalizedRoot, linkedFile.path),
            );
          } catch (error) {
            await mkdir(target, { recursive: true }).catch(() => undefined);
            throw error;
          }
        }
        return result(message);
      });
    },

    writeTextFile(repositoryPath, content, message, revision) {
      return runMutation(async () => {
        const target = await resolveSafeRepositoryPath(
          normalizedRoot,
          repositoryPath,
        );
        await mkdir(path.dirname(target), { recursive: true });
        if (revision) {
          await assertRevision(normalizedRoot, repositoryPath, revision);
        } else {
          await assertDestinationAvailable(target);
        }

        const temporary = `${target}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temporary, content, {
            encoding: 'utf8',
            flag: 'wx',
          });
          if (revision) {
            await assertRevision(normalizedRoot, repositoryPath, revision);
          } else {
            await assertDestinationAvailable(target);
          }
          await rename(temporary, target);
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined);
        }
        const saved = await readSourceFile(normalizedRoot, repositoryPath);
        return result(message, saved?.revision);
      });
    },

    writeBinaryFile(repositoryPath, content, message) {
      return runMutation(async () => {
        const target = await resolveSafeRepositoryPath(
          normalizedRoot,
          repositoryPath,
        );
        await mkdir(path.dirname(target), { recursive: true });
        try {
          await writeFile(target, content, { flag: 'wx' });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new ContentConflictError('path_exists');
          }
          throw error;
        }
        const saved = await readSourceFile(normalizedRoot, repositoryPath);
        return result(message, saved?.revision);
      });
    },

    deleteFile(repositoryPath, message, revision) {
      return runMutation(async () => {
        await assertRevision(normalizedRoot, repositoryPath, revision);
        const target = await resolveSafeRepositoryPath(
          normalizedRoot,
          repositoryPath,
        );
        await assertRevision(normalizedRoot, repositoryPath, revision);
        await unlink(target);
        return result(message);
      });
    },
  };
}
