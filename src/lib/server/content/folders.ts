import { adminJson } from '../admin/response';
import { readJsonBody, requestBodyErrorResponse } from '../core/body';
import {
  contentWithOrder,
  ensureFolderDocument,
  findFolderDocument,
  folderDocumentPath,
  folderExists,
  folderName,
  folderRepositoryPath,
  nextSiblingOrder,
  parentFolder,
  readEntries,
  readFolders,
  uniqueContentId,
} from './documents';
import {
  contentConflictResponse,
  contentFolderErrorResponse,
  invalidFolder,
  methodNotAllowed,
  missingCollection,
} from './http';
import { isValidFolderPath, normalizeFolderPath, sourcePath } from './paths';
import { getContentCollection } from './registry';
import type { ContentCollectionDefinition, ContentProvider } from './types';

async function performFolderTreeDuplicate(
  store: ContentProvider,
  collection: ContentCollectionDefinition,
  sourceFolder: string,
  destinationFolder: string,
): Promise<void> {
  const entries = await readEntries(store, collection);
  const reservedIds = new Set(entries.map((entry) => entry.id));
  const destinationId = folderName(destinationFolder);
  if (reservedIds.has(destinationId)) {
    throw Object.assign(new Error('A note already uses that folder name.'), {
      code: 'path_exists',
    });
  }
  reservedIds.add(destinationId);

  const directories = (await store.listDirectories(collection.sourceDir))
    .map((directory) =>
      directory.startsWith(`${collection.sourceDir}/`)
        ? directory.slice(collection.sourceDir.length + 1)
        : '',
    )
    .filter(Boolean);
  const sourceDirectories = [
    sourceFolder,
    ...directories.filter((directory) =>
      directory.startsWith(`${sourceFolder}/`),
    ),
  ].toSorted(
    (left, right) =>
      left.split('/').length - right.split('/').length ||
      left.localeCompare(right),
  );
  const destinationBySource = new Map<string, string>([
    [sourceFolder, destinationFolder],
  ]);

  await store.createDirectory(
    folderRepositoryPath(collection, destinationFolder),
    `content: duplicate folder ${collection.id}/${sourceFolder}`,
  );

  for (const sourceDirectory of sourceDirectories.slice(1)) {
    const destinationParent = destinationBySource.get(
      parentFolder(sourceDirectory),
    );
    if (!destinationParent) {
      throw new Error(`Could not map duplicated folder ${sourceDirectory}.`);
    }
    const destinationName = uniqueContentId(
      `${folderName(sourceDirectory)}-copy`,
      reservedIds,
    );
    const destinationDirectory = [destinationParent, destinationName]
      .filter(Boolean)
      .join('/');
    destinationBySource.set(sourceDirectory, destinationDirectory);
    await store.createDirectory(
      folderRepositoryPath(collection, destinationDirectory),
      `content: duplicate folder ${collection.id}/${sourceDirectory}`,
    );
  }

  const sourcePage = await findFolderDocument(store, collection, sourceFolder);
  if (sourcePage) {
    await store.writeTextFile(
      folderDocumentPath(collection, destinationFolder),
      contentWithOrder(
        collection,
        sourcePage.file.content,
        nextSiblingOrder(entries, parentFolder(destinationFolder)),
      ),
      `content: duplicate folder page ${collection.id}/${sourceFolder}`,
    );
  } else {
    await ensureFolderDocument(store, collection, destinationFolder);
  }

  for (const entry of entries) {
    if (
      entry.folder !== sourceFolder &&
      !entry.folder.startsWith(`${sourceFolder}/`)
    ) {
      continue;
    }

    const source = await store.readFile(entry.path);
    if (!source) continue;
    const childFolder = [entry.folder, entry.id].filter(Boolean).join('/');
    const mappedChildFolder = destinationBySource.get(childFolder);
    const destinationEntryFolder = mappedChildFolder
      ? parentFolder(mappedChildFolder)
      : destinationBySource.get(entry.folder);
    if (destinationEntryFolder === undefined) {
      throw new Error(`Could not map duplicated note ${entry.path}.`);
    }
    const destinationEntryId = mappedChildFolder
      ? folderName(mappedChildFolder)
      : uniqueContentId(`${entry.id}-copy`, reservedIds);

    await store.writeTextFile(
      sourcePath(
        collection.sourceDir,
        destinationEntryId,
        collection.extension,
        destinationEntryFolder,
      ),
      source.content,
      `content: duplicate ${collection.id}/${entry.id}`,
    );
  }
}

/**
 * Copies a folder, its page, and everything under it, rolling back on failure.
 *
 * Shared with the entry duplicate path: a note that is also a folder's page is
 * the same object seen from the other side, so duplicating it has to mean this
 * and not "copy one file".
 */
export async function duplicateFolderTree(
  store: ContentProvider,
  collection: ContentCollectionDefinition,
  sourceFolder: string,
  destinationFolder: string,
): Promise<void> {
  const filesBefore = new Set(
    (
      await store.listFiles(collection.sourceDir, collection.readExtensions)
    ).map((file) => file.path),
  );
  const directoriesBefore = new Set(
    await store.listDirectories(collection.sourceDir),
  );

  try {
    await performFolderTreeDuplicate(
      store,
      collection,
      sourceFolder,
      destinationFolder,
    );
  } catch (error) {
    // A duplicate spans several provider writes. Remove only paths introduced
    // by this attempt before the request-level mutation lock is released, so a
    // transport failure cannot publish a partial copy.
    try {
      const createdFiles = (
        await store.listFiles(collection.sourceDir, collection.readExtensions)
      ).filter((file) => !filesBefore.has(file.path));
      for (const file of createdFiles.toReversed()) {
        await store
          .deleteFile(
            file.path,
            'content: roll back folder duplicate',
            file.revision,
          )
          .catch(() => undefined);
      }

      const createdDirectories = (
        await store.listDirectories(collection.sourceDir)
      )
        .filter((directory) => !directoriesBefore.has(directory))
        .toSorted(
          (left, right) =>
            right.split('/').length - left.split('/').length ||
            right.localeCompare(left),
        );
      for (const directory of createdDirectories) {
        await store
          .deleteDirectory(directory, 'content: roll back folder duplicate')
          .catch(() => undefined);
      }
    } catch (rollbackError) {
      console.error(
        '[content] Folder duplicate rollback failed.',
        rollbackError,
      );
    }
    throw error;
  }
}

function folderNotFound(): Response {
  return adminJson(
    { error: 'That folder no longer exists.', code: 'folder_not_found' },
    { status: 404 },
  );
}

export async function handleContentFolders(
  store: ContentProvider,
  collectionId: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();

  if (request.method === 'GET') {
    return adminJson({ folders: await readFolders(store, collection) });
  }

  let body: { path?: unknown; nextPath?: unknown; copyFrom?: unknown };
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const folder = normalizeFolderPath(String(body.path ?? ''));
  if (!folder || !isValidFolderPath(folder, false)) return invalidFolder();

  if (request.method === 'POST') {
    if (await folderExists(store, collection, folder)) {
      return adminJson(
        { error: 'That folder already exists.', code: 'folder_exists' },
        { status: 409 },
      );
    }
    if (!(await folderExists(store, collection, parentFolder(folder)))) {
      return folderNotFound();
    }

    const entries = await readEntries(store, collection);
    if (entries.some((entry) => entry.id === folderName(folder))) {
      return adminJson(
        { error: 'A note already uses that folder name.', code: 'slug_exists' },
        { status: 409 },
      );
    }

    const copyFrom = normalizeFolderPath(String(body.copyFrom ?? ''));
    if (copyFrom) {
      if (!isValidFolderPath(copyFrom, false)) return invalidFolder();
      if (!(await folderExists(store, collection, copyFrom))) {
        return folderNotFound();
      }
      if (folder.startsWith(`${copyFrom}/`)) {
        return adminJson(
          {
            error: 'A folder cannot be duplicated inside itself.',
            code: 'invalid_folder_move',
          },
          { status: 400 },
        );
      }
      try {
        await duplicateFolderTree(store, collection, copyFrom, folder);
      } catch (error) {
        return contentConflictResponse(error);
      }
      return adminJson(
        {
          folders: await readFolders(store, collection),
          duplicated: folder,
        },
        { status: 201 },
      );
    }

    const repositoryPath = folderRepositoryPath(collection, folder);
    try {
      const result = await store.createDirectory(
        repositoryPath,
        `content: create folder ${collection.id}/${folder}`,
      );
      await ensureFolderDocument(store, collection, folder);
      return adminJson(
        { folders: await readFolders(store, collection), result },
        { status: 201 },
      );
    } catch (error) {
      await store
        .deleteDirectory(repositoryPath, 'content: roll back folder creation')
        .catch(() => undefined);
      return contentConflictResponse(error);
    }
  }

  if (request.method === 'PATCH') {
    const nextFolder = normalizeFolderPath(String(body.nextPath ?? ''));
    if (!nextFolder || !isValidFolderPath(nextFolder, false)) {
      return invalidFolder();
    }
    if (nextFolder === folder) {
      return adminJson({ folders: await readFolders(store, collection) });
    }
    if (nextFolder.startsWith(`${folder}/`)) {
      return adminJson(
        {
          error: 'A folder cannot be moved inside itself.',
          code: 'invalid_folder_move',
        },
        { status: 400 },
      );
    }
    if (!(await folderExists(store, collection, folder))) {
      return folderNotFound();
    }
    if (!(await folderExists(store, collection, parentFolder(nextFolder)))) {
      return folderNotFound();
    }
    if (await folderExists(store, collection, nextFolder)) {
      return adminJson(
        { error: 'That folder already exists.', code: 'folder_exists' },
        { status: 409 },
      );
    }

    const previousPage = await findFolderDocument(store, collection, folder);
    // The page moves to the canonical extension even if it was stored under a
    // legacy one, so a rename doubles as a migration of that file.
    const nextPagePath = folderDocumentPath(collection, nextFolder);
    const entries = await readEntries(store, collection);
    const conflictingEntry = entries.find(
      (entry) =>
        entry.id === folderName(nextFolder) &&
        entry.path !== previousPage?.path,
    );
    if (
      conflictingEntry ||
      (await findFolderDocument(store, collection, nextFolder))
    ) {
      return adminJson(
        { error: 'A note already uses that folder name.', code: 'slug_exists' },
        { status: 409 },
      );
    }

    try {
      const result = await store.moveDirectory(
        folderRepositoryPath(collection, folder),
        folderRepositoryPath(collection, nextFolder),
        `content: move folder ${collection.id}/${folder} to ${nextFolder}`,
        previousPage
          ? {
              from: previousPage.path,
              to: nextPagePath,
              revision: previousPage.file.revision,
            }
          : undefined,
      );
      if (!previousPage) {
        await ensureFolderDocument(store, collection, nextFolder);
      }
      const updatedEntries = await readEntries(store, collection);
      const previousById = new Map(entries.map((entry) => [entry.id, entry]));
      const moved = updatedEntries.flatMap((entry) => {
        const isPage = entry.path === nextPagePath;
        if (
          !isPage &&
          entry.folder !== nextFolder &&
          !entry.folder.startsWith(`${nextFolder}/`)
        )
          return [];
        const previous = previousById.get(
          isPage ? folderName(folder) : entry.id,
        );
        return previous
          ? [
              {
                previousId: previous.id,
                previousRevision: previous.revision,
                entry,
              },
            ]
          : [];
      });
      return adminJson({
        folders: await readFolders(store, collection, updatedEntries),
        moved,
        result,
      });
    } catch (error) {
      return contentConflictResponse(error);
    }
  }

  if (request.method === 'DELETE') {
    if (!(await folderExists(store, collection, folder))) {
      return folderNotFound();
    }

    const page = await findFolderDocument(store, collection, folder);
    try {
      const result = await store.deleteDirectory(
        folderRepositoryPath(collection, folder),
        `content: delete folder ${collection.id}/${folder}`,
        page ? { path: page.path, revision: page.file.revision } : undefined,
      );
      return adminJson({
        folders: await readFolders(store, collection),
        result,
      });
    } catch (error) {
      return contentFolderErrorResponse(error);
    }
  }

  return methodNotAllowed(['GET', 'POST', 'PATCH', 'DELETE']);
}
