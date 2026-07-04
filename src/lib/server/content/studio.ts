import { execFile } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getContentCollection } from './registry';
import { assertSafeRepositoryPath, isValidSlug } from './paths';
import type {
  ContentCollectionId,
  ContentDraft,
  ContentRevision,
  MediaAsset,
  PublishJob,
} from './types';

const execFileAsync = promisify(execFile);
const STUDIO_DIR = '.oddava-studio';
const DRAFTS_DIR = `${STUDIO_DIR}/drafts`;
const JOBS_DIR = `${STUDIO_DIR}/publish-jobs`;
const MEDIA_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png', '.gif']);

function resolveStudioPath(
  projectRoot: string,
  repositoryPath: string,
): string {
  assertSafeRepositoryPath(repositoryPath);
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedPath = path.resolve(resolvedRoot, repositoryPath);

  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error('Unsafe studio path.');
  }

  return resolvedPath;
}

function draftRepositoryPath(collection: string, id: string): string {
  if (!isValidSlug(collection) || !isValidSlug(id)) {
    throw new Error('Invalid draft path.');
  }
  return `${DRAFTS_DIR}/${collection}/${id}.json`;
}

function jobRepositoryPath(id: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid publish job id.');
  return `${JOBS_DIR}/${id}.json`;
}

async function readJsonFile<T>(
  projectRoot: string,
  repositoryPath: string,
): Promise<T | null> {
  try {
    return JSON.parse(
      await readFile(resolveStudioPath(projectRoot, repositoryPath), 'utf8'),
    ) as T;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(
  projectRoot: string,
  repositoryPath: string,
  value: unknown,
): Promise<void> {
  const absolutePath = resolveStudioPath(projectRoot, repositoryPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readDraft(
  projectRoot: string,
  collection: string,
  id: string,
): Promise<ContentDraft | null> {
  return readJsonFile<ContentDraft>(
    projectRoot,
    draftRepositoryPath(collection, id),
  );
}

export async function writeDraft(
  projectRoot: string,
  draft: ContentDraft,
): Promise<ContentDraft> {
  const now = new Date().toISOString();
  const current = await readDraft(projectRoot, draft.collection, draft.id);
  const next = {
    ...draft,
    createdAt: current?.createdAt ?? draft.createdAt ?? now,
    updatedAt: now,
  };

  await writeJsonFile(
    projectRoot,
    draftRepositoryPath(next.collection, next.id),
    next,
  );
  return next;
}

export async function deleteDraft(
  projectRoot: string,
  collection: string,
  id: string,
): Promise<void> {
  await rm(
    resolveStudioPath(projectRoot, draftRepositoryPath(collection, id)),
    {
      force: true,
    },
  );
}

export async function listDrafts(projectRoot: string): Promise<ContentDraft[]> {
  const root = resolveStudioPath(projectRoot, DRAFTS_DIR);

  try {
    const collectionDirs = await readdir(root, { withFileTypes: true });
    const drafts = await Promise.all(
      collectionDirs
        .filter((entry) => entry.isDirectory())
        .flatMap(async (collectionDir) => {
          const collection = collectionDir.name;
          const directory = path.join(root, collection);
          const entries = await readdir(directory, { withFileTypes: true });

          return Promise.all(
            entries
              .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
              .map(async (entry) => {
                const id = entry.name.replace(/\.json$/, '');
                return readDraft(projectRoot, collection, id);
              }),
          );
        }),
    );

    return drafts
      .flat()
      .filter((draft): draft is ContentDraft => Boolean(draft));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function collectFiles(
  absoluteDirectory: string,
  predicate: (absolutePath: string) => boolean,
): Promise<string[]> {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) return collectFiles(absolutePath, predicate);
      if (!entry.isFile() || !predicate(absolutePath)) return [];
      return [absolutePath];
    }),
  );

  return files.flat();
}

async function contentReferenceText(projectRoot: string): Promise<string> {
  const contentRoot = path.join(projectRoot, 'src/content');

  try {
    const files = await collectFiles(contentRoot, (absolutePath) =>
      ['.mdx', '.yaml', '.yml', '.md'].includes(path.extname(absolutePath)),
    );
    const content = await Promise.all(
      files.map((file) => readFile(file, 'utf8').catch(() => '')),
    );
    return content.join('\n');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export async function listMediaAssets(
  projectRoot: string,
): Promise<MediaAsset[]> {
  const imagesRoot = path.join(projectRoot, 'public/images');
  const references = await contentReferenceText(projectRoot);

  try {
    const files = await collectFiles(imagesRoot, (absolutePath) =>
      MEDIA_EXTENSIONS.has(path.extname(absolutePath).toLowerCase()),
    );

    const assets = await Promise.all(
      files.map(async (absolutePath) => {
        const fileStat = await stat(absolutePath);
        const repositoryPath = path
          .relative(projectRoot, absolutePath)
          .replace(/\\/g, '/');
        const url = `/${repositoryPath.replace(/^public\//, '')}`;
        const segments = repositoryPath.split('/');
        const collection = getContentCollection(segments[2])?.id;
        const entryId =
          collection && isValidSlug(segments[3] ?? '')
            ? segments[3]
            : undefined;

        return {
          path: repositoryPath,
          url,
          name: path.basename(absolutePath),
          collection,
          entryId,
          size: fileStat.size,
          modifiedAt: fileStat.mtime.toISOString(),
          referenced: references.includes(url),
        } satisfies MediaAsset;
      }),
    );

    return assets.toSorted((left, right) =>
      right.modifiedAt.localeCompare(left.modifiedAt),
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function deleteMediaAsset(
  projectRoot: string,
  url: string,
): Promise<void> {
  if (!url.startsWith('/images/')) throw new Error('Invalid media URL.');
  const repositoryPath = `public${url}`;
  await rm(resolveStudioPath(projectRoot, repositoryPath), { force: true });
}

export async function readPublishJob(
  projectRoot: string,
  id: string,
): Promise<PublishJob | null> {
  return readJsonFile<PublishJob>(projectRoot, jobRepositoryPath(id));
}

export async function writePublishJob(
  projectRoot: string,
  job: PublishJob,
): Promise<PublishJob> {
  const next = { ...job, updatedAt: new Date().toISOString() };
  await writeJsonFile(projectRoot, jobRepositoryPath(job.id), next);
  return next;
}

export async function readContentHistory(
  projectRoot: string,
  repositoryPath: string,
): Promise<ContentRevision[]> {
  assertSafeRepositoryPath(repositoryPath);

  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        'log',
        '--format=%H%x09%h%x09%an%x09%ad%x09%s',
        '--date=iso-strict',
        '--',
        repositoryPath,
      ],
      { cwd: projectRoot },
    );

    return stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, author, authoredAt, ...subject] =
          line.split('\t');
        return {
          hash: hash ?? '',
          shortHash: shortHash ?? '',
          author: author ?? '',
          authoredAt: authoredAt ?? '',
          subject: subject.join('\t'),
        };
      })
      .filter((revision) => revision.hash);
  } catch {
    return [];
  }
}

export async function readRevisionContent(
  projectRoot: string,
  repositoryPath: string,
  hash: string,
): Promise<string> {
  assertSafeRepositoryPath(repositoryPath);
  if (!/^[a-f0-9]{7,40}$/i.test(hash)) throw new Error('Invalid revision.');

  const { stdout } = await execFileAsync(
    'git',
    ['show', `${hash}:${repositoryPath.replace(/\\/g, '/')}`],
    { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout;
}

export function createPublishJob(
  collection: ContentCollectionId,
  entryId: string,
  stepLabels: string[],
): PublishJob {
  const now = new Date().toISOString();
  return {
    id: `publish-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    collection,
    entryId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    steps: stepLabels.map((label) => ({ label, status: 'pending' })),
  };
}
