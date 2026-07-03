import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { assertSafeRepositoryPath } from './paths';
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
          revision: `local:${fileStat.mtimeMs}`,
        },
      ];
    }),
  );

  return files.flat();
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
          revision: `local:${fileStat.mtimeMs}`,
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
    async writeTextFile(repositoryPath, content, message) {
      const absolutePath = resolveSafePath(projectRoot, repositoryPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, 'utf8');
      const fileStat = await stat(absolutePath);
      return result(message, `local:${fileStat.mtimeMs}`);
    },
    async writeBinaryFile(repositoryPath, content, message) {
      const absolutePath = resolveSafePath(projectRoot, repositoryPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
      const fileStat = await stat(absolutePath);
      return result(message, `local:${fileStat.mtimeMs}`);
    },
    async deleteFile(repositoryPath, message) {
      await rm(resolveSafePath(projectRoot, repositoryPath), { force: true });
      return result(message);
    },
  };
}
