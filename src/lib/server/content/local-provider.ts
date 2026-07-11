import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { assertSafeRepositoryPath } from './paths';
import {
  ContentFolderNotEmptyError,
  ContentRevisionConflictError,
} from './types';
import type {
  ContentProvider,
  ContentSourceFile,
  ContentWriteResult,
} from './types';

async function collectFiles(
  root: string,
  directory: string,
  extension: string,
): Promise<ContentSourceFile[]> {
  const absoluteDirectory = resolveSafePath(root, directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = `${directory}/${entry.name}`.replace(/\\/g, '/');
      if (entry.isDirectory()) {
        return collectFiles(root, relativePath, extension);
      }
      if (!entry.isFile() || !entry.name.endsWith(`.${extension}`)) return [];
      const content = await readFile(
        resolveSafePath(root, relativePath),
        'utf8',
      );
      const fileStat = await stat(resolveSafePath(root, relativePath));
      return [
        {
          path: relativePath,
          content,
          revision: revisionFromStat(fileStat),
        },
      ];
    }),
  );

  return files.flat();
}

async function collectDirectories(
  root: string,
  directory: string,
): Promise<string[]> {
  const absoluteDirectory = resolveSafePath(root, directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const nested = await Promise.all(
    directories.map(async (entry) => {
      const relativePath = `${directory}/${entry.name}`.replace(/\\/g, '/');
      return [relativePath, ...(await collectDirectories(root, relativePath))];
    }),
  );
  return nested.flat();
}

async function containsContentFiles(
  absoluteDirectory: string,
): Promise<boolean> {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (
        await containsContentFiles(path.join(absoluteDirectory, entry.name))
      ) {
        return true;
      }
      continue;
    }
    if (entry.isFile() && entry.name !== '.gitkeep') return true;
  }
  return false;
}

function resolveSafePath(root: string, repositoryPath: string): string {
  assertSafeRepositoryPath(repositoryPath);
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, repositoryPath);
  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error('Unsafe local content path.');
  }
  return resolvedPath;
}

function result(message: string, revision?: string): ContentWriteResult {
  return {
    provider: 'local',
    revision,
    message,
  };
}

function revisionFromStat(fileStat: Awaited<ReturnType<typeof stat>>): string {
  return `local:${fileStat.mtimeMs}`;
}

async function assertCurrentRevision(
  absolutePath: string,
  expectedRevision: string | undefined,
): Promise<void> {
  if (!expectedRevision) return;

  try {
    const currentRevision = revisionFromStat(await stat(absolutePath));
    if (currentRevision !== expectedRevision) {
      throw new ContentRevisionConflictError();
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new ContentRevisionConflictError();
    }
    throw error;
  }
}

export function createLocalContentProvider(
  projectRoot: string,
): ContentProvider {
  return {
    kind: 'local',
    async listFiles(directory, extension) {
      try {
        return await collectFiles(projectRoot, directory, extension);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return [];
        }
        throw error;
      }
    },
    async readFile(repositoryPath) {
      try {
        const absolutePath = resolveSafePath(projectRoot, repositoryPath);
        const content = await readFile(absolutePath, 'utf8');
        const fileStat = await stat(absolutePath);
        return {
          path: repositoryPath,
          content,
          revision: revisionFromStat(fileStat),
        };
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return null;
        }
        throw error;
      }
    },
    async listDirectories(directory) {
      try {
        return await collectDirectories(projectRoot, directory);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return [];
        }
        throw error;
      }
    },
    async createDirectory(repositoryPath, message) {
      const absolutePath = resolveSafePath(projectRoot, repositoryPath);
      await mkdir(absolutePath, { recursive: true });
      await writeFile(path.join(absolutePath, '.gitkeep'), '', { flag: 'a' });
      return result(message);
    },
    async movePath(from, to, message, revision) {
      const absoluteFrom = resolveSafePath(projectRoot, from);
      const absoluteTo = resolveSafePath(projectRoot, to);
      await assertCurrentRevision(absoluteFrom, revision);
      await mkdir(path.dirname(absoluteTo), { recursive: true });
      await rename(absoluteFrom, absoluteTo);
      let nextRevision: string | undefined;
      try {
        const movedStat = await stat(absoluteTo);
        if (movedStat.isFile()) nextRevision = revisionFromStat(movedStat);
      } catch {
        nextRevision = undefined;
      }
      return result(message, nextRevision);
    },
    async deleteDirectory(repositoryPath, message) {
      const absolutePath = resolveSafePath(projectRoot, repositoryPath);
      if (await containsContentFiles(absolutePath)) {
        throw new ContentFolderNotEmptyError();
      }
      await rm(absolutePath, { recursive: true, force: true });
      return result(message);
    },
    async writeTextFile(repositoryPath, content, message, revision) {
      const absolutePath = resolveSafePath(projectRoot, repositoryPath);
      await assertCurrentRevision(absolutePath, revision);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, 'utf8');
      const fileStat = await stat(absolutePath);
      return result(message, revisionFromStat(fileStat));
    },
    async writeBinaryFile(repositoryPath, content, message, revision) {
      const absolutePath = resolveSafePath(projectRoot, repositoryPath);
      await assertCurrentRevision(absolutePath, revision);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
      const fileStat = await stat(absolutePath);
      return result(message, revisionFromStat(fileStat));
    },
    async deleteFile(repositoryPath, message, revision) {
      const absolutePath = resolveSafePath(projectRoot, repositoryPath);
      await assertCurrentRevision(absolutePath, revision);
      await rm(absolutePath, { force: true });
      return result(message);
    },
  };
}
