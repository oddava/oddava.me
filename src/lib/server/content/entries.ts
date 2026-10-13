import { adminJson } from '../admin/response';
import { readJsonBody, requestBodyErrorResponse } from '../core/body';
import {
  contentWithOrder,
  entriesFromFiles,
  findEntry,
  folderExists,
  folderRepositoryPath,
  nextSiblingOrder,
  publicCollection,
  readEntries,
  readFolders,
  toDetail,
  validateFields,
} from './documents';
import { duplicateFolderTree } from './folders';
import {
  contentConflictResponse,
  contentFolderErrorResponse,
  folderAlreadyExists,
  folderNotFound,
  invalidFolder,
  invalidFolderMove,
  invalidSlug,
  methodNotAllowed,
  missingCollection,
  missingEntry,
  readRevision,
  revisionRequired,
  slugExists,
  validationError,
} from './http';
import {
  entryFolderFromPath,
  isValidFolderPath,
  isValidSlug,
  normalizeFolderPath,
  slugify,
  sourcePath,
} from './paths';
import { getContentCollection, NOTES_COLLECTION } from './registry';
import { parseContentDocument, serializeContentDocument } from './serializers';
import { ContentConflictError } from './types';
import type {
  BatchTextWrite,
  ContentCollectionDefinition,
  ContentProvider,
  ContentWriteResult,
} from './types';

interface SaveEntryBody {
  slug?: string;
  folder?: string;
  fields?: Record<string, unknown>;
  body?: string;
  revision?: string;
}

function rootEntryResponse(): Response {
  return adminJson(
    {
      error: 'The Notes root cannot be moved, renamed, or deleted.',
      code: 'root_entry',
    },
    { status: 400 },
  );
}

/**
 * The entry as this request just wrote it. Every handler runs under the content
 * mutation lock, so the write's own content and revision are what a re-read
 * would return — reading the file back would only add a round trip while the
 * lock is held.
 */
function writtenEntry(
  collection: ContentCollectionDefinition,
  path: string,
  content: string,
  result: ContentWriteResult,
) {
  return result.revision
    ? toDetail(collection, { path, content, revision: result.revision })
    : null;
}

function headingSlug(body: string): string {
  const heading = body.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1] ?? '';
  return slugify(heading);
}

export async function handleContentCollections(
  store: ContentProvider,
): Promise<Response> {
  // Paths only: a count does not need every note's content. Notes are always
  // written as text, so every path here is an entry.
  const count = (
    await store.listFilePaths(
      NOTES_COLLECTION.sourceDir,
      NOTES_COLLECTION.readExtensions,
    )
  ).length;
  return adminJson({
    collections: [{ ...publicCollection(NOTES_COLLECTION), count }],
  });
}

export async function handleContentCollection(
  store: ContentProvider,
  collectionId: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();

  if (request.method === 'GET') {
    const entries = await readEntries(store, collection);
    return adminJson({
      collection: publicCollection(collection),
      entries,
      folders: await readFolders(store, collection, entries),
    });
  }
  if (request.method !== 'POST') return methodNotAllowed(['GET', 'POST']);

  let body: SaveEntryBody;
  try {
    body = await readJsonBody<SaveEntryBody>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const fields = body.fields ?? {};
  const contentBody = String(body.body ?? '');
  const slug =
    body.slug?.trim() ||
    slugify(String(fields.title ?? '')) ||
    headingSlug(contentBody);
  if (!isValidSlug(slug)) return invalidSlug();

  const folder = normalizeFolderPath(body.folder ?? '');
  if (!isValidFolderPath(folder)) return invalidFolder();
  if (!(await folderExists(store, collection, folder))) {
    return folderNotFound('Choose a folder that still exists.');
  }

  const entries = await readEntries(store, collection);
  if (entries.some((entry) => entry.id === slug)) {
    return slugExists('A note already uses that file name.');
  }

  let validatedFields: Record<string, unknown>;
  try {
    validatedFields = validateFields(collection, fields);
  } catch (error) {
    return validationError(error);
  }
  validatedFields[collection.orderField] = nextSiblingOrder(entries, folder);
  validatedFields.updated = new Date().toISOString();

  const path = sourcePath(
    collection.sourceDir,
    slug,
    collection.extension,
    folder,
  );
  const content = serializeContentDocument(validatedFields, contentBody);
  let result: ContentWriteResult;
  try {
    result = await store.writeTextFile(
      path,
      content,
      `content: create ${collection.id}/${slug}`,
    );
  } catch (error) {
    return contentConflictResponse(error);
  }

  return adminJson(
    { entry: writtenEntry(collection, path, content, result), result },
    { status: 201 },
  );
}

export async function handleContentEntry(
  store: ContentProvider,
  collectionId: string | undefined,
  id: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!id || !isValidSlug(id)) return invalidSlug();

  const existing = await findEntry(store, collection, id);
  if (!existing) return missingEntry();

  if (request.method === 'GET') {
    return adminJson({
      collection: publicCollection(collection),
      entry: toDetail(collection, existing),
    });
  }

  if (request.method === 'DELETE') {
    const rootPaths = collection.readExtensions.map(
      (extension) => `${collection.sourceDir}/index.${extension}`,
    );
    if (id === 'index' && rootPaths.includes(existing.path)) {
      return rootEntryResponse();
    }

    let body: { revision?: unknown };
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return requestBodyErrorResponse(error);
    }
    const revision = readRevision(body);
    if (!revision) return revisionRequired();

    // Deleting a folder's page is deleting the folder: leaving the directory
    // behind would strand its notes under a folder that no longer has a page,
    // and the folders API is the only thing that could then reach them.
    // deleteDirectory refuses a non-empty folder, which is the same answer
    // /folders gives — move the notes out first.
    const currentFolder = entryFolderFromPath(
      existing.path,
      collection.sourceDir,
    );
    const pairedFolder = currentFolder ? `${currentFolder}/${id}` : id;

    try {
      if (await folderExists(store, collection, pairedFolder)) {
        const result = await store.deleteDirectory(
          folderRepositoryPath(collection, pairedFolder),
          `content: delete folder ${collection.id}/${pairedFolder}`,
          { path: existing.path, revision },
        );
        return adminJson({ result });
      }

      const result = await store.deleteFile(
        existing.path,
        `content: delete ${collection.id}/${id}`,
        revision,
      );
      return adminJson({ result });
    } catch (error) {
      return contentFolderErrorResponse(error);
    }
  }

  if (request.method !== 'PUT')
    return methodNotAllowed(['GET', 'PUT', 'DELETE']);

  let body: SaveEntryBody;
  try {
    body = await readJsonBody<SaveEntryBody>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const revision = readRevision(body);
  if (!revision) return revisionRequired();

  let fields: Record<string, unknown>;
  try {
    fields = validateFields(collection, body.fields ?? {});
  } catch (error) {
    return validationError(error);
  }
  fields.updated = new Date().toISOString();

  const content = serializeContentDocument(fields, String(body.body ?? ''));
  try {
    const result = await store.writeTextFile(
      existing.path,
      content,
      `content: update ${collection.id}/${id}`,
      revision,
    );
    return adminJson({
      entry: writtenEntry(collection, existing.path, content, result),
      result,
    });
  } catch (error) {
    return contentConflictResponse(error);
  }
}

export async function handleContentMove(
  store: ContentProvider,
  collectionId: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  let body: {
    id?: unknown;
    folder?: unknown;
    nextId?: unknown;
    operation?: unknown;
    revision?: unknown;
  };
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const id = String(body.id ?? '');
  const nextId = String(body.nextId ?? id);
  const folder = normalizeFolderPath(String(body.folder ?? ''));
  const operation = body.operation === 'duplicate' ? 'duplicate' : 'move';
  const revision = readRevision(body);
  if (!isValidSlug(id) || !isValidSlug(nextId)) return invalidSlug();
  if (!isValidFolderPath(folder)) return invalidFolder();
  if (!revision) return revisionRequired();
  if (id === 'index' && (nextId !== 'index' || folder !== '')) {
    return rootEntryResponse();
  }
  if (!(await folderExists(store, collection, folder))) {
    return folderNotFound('Choose a folder that still exists.');
  }

  const existing = await findEntry(store, collection, id);
  if (!existing) return missingEntry();
  if (existing.revision !== revision) {
    return contentConflictResponse(
      new ContentConflictError('revision_conflict'),
    );
  }
  const entries = await readEntries(store, collection);
  if (nextId !== id && entries.some((entry) => entry.id === nextId)) {
    return slugExists('A note already uses that file name.');
  }

  const currentFolder = entryFolderFromPath(
    existing.path,
    collection.sourceDir,
  );
  if (operation === 'duplicate' && nextId === id) {
    return slugExists('Choose a new file name for the copy.');
  }
  if (operation === 'move' && currentFolder === folder && nextId === id) {
    return adminJson({ entry: toDetail(collection, existing) });
  }

  const nextPath = sourcePath(
    collection.sourceDir,
    nextId,
    collection.extension,
    folder,
  );

  // A note can also be a folder's page: `reading.md` sitting beside `reading/`.
  // The two are one thing to the author, and folders.ts already treats them
  // that way. Acting on the file alone would leave the folder with no page and
  // the page with no folder — both orphaned, and no single later operation puts
  // them back.
  const pairedFolder = currentFolder ? `${currentFolder}/${id}` : id;
  const isFolderPage = await folderExists(store, collection, pairedFolder);
  const nextPairedFolder = folder ? `${folder}/${nextId}` : nextId;

  try {
    if (isFolderPage) {
      if (
        nextPairedFolder === pairedFolder ||
        folder === pairedFolder ||
        folder.startsWith(`${pairedFolder}/`)
      ) {
        return invalidFolderMove(
          `A folder cannot be ${operation === 'duplicate' ? 'copied' : 'moved'} inside itself.`,
        );
      }
      if (await folderExists(store, collection, nextPairedFolder)) {
        return folderAlreadyExists();
      }

      if (operation === 'duplicate') {
        // Same primitive the folders API uses, rollback included: a copy of a
        // folder page means a copy of the folder.
        await duplicateFolderTree(
          store,
          collection,
          pairedFolder,
          nextPairedFolder,
        );
        const duplicated = await store.readFile(nextPath);
        return adminJson({
          entry: duplicated ? toDetail(collection, duplicated) : null,
          result: {
            message: `content: duplicate folder ${collection.id}/${pairedFolder} as ${nextPairedFolder}`,
            revision: duplicated?.revision,
          },
        });
      }

      // The directory move and the page move are one script, so the pair cannot
      // come apart between them.
      const result = await store.moveDirectory(
        folderRepositoryPath(collection, pairedFolder),
        folderRepositoryPath(collection, nextPairedFolder),
        `content: move folder ${collection.id}/${pairedFolder} to ${nextPairedFolder}`,
        { from: existing.path, to: nextPath, revision },
      );
      const moved = await store.readFile(nextPath);
      return adminJson({
        entry: moved ? toDetail(collection, moved) : null,
        result,
      });
    }

    if (operation === 'duplicate') {
      const content = contentWithOrder(
        collection,
        existing.content,
        nextSiblingOrder(entries, folder),
      );
      const result = await store.writeTextFile(
        nextPath,
        content,
        `content: duplicate ${collection.id}/${id} as ${nextId}`,
      );
      return adminJson({
        entry: writtenEntry(collection, nextPath, content, result),
        result,
      });
    }

    const result = await store.moveFile(
      existing.path,
      nextPath,
      `content: move ${collection.id}/${id} to ${folder || 'root'}/${nextId}`,
      revision,
    );
    return adminJson({
      entry: writtenEntry(collection, nextPath, existing.content, result),
      result,
    });
  } catch (error) {
    return contentConflictResponse(error);
  }
}

export async function handleContentReorder(
  store: ContentProvider,
  collectionId: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  let body: { ids?: unknown; folder?: unknown };
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
  const folder = normalizeFolderPath(String(body.folder ?? ''));
  if (!ids?.length || ids.some((id) => !isValidSlug(id))) {
    return adminJson(
      {
        error: 'A non-empty array of valid entry ids is required.',
        code: 'invalid_ids',
      },
      { status: 400 },
    );
  }
  if (!isValidFolderPath(folder)) return invalidFolder();
  if (!(await folderExists(store, collection, folder))) {
    return folderNotFound();
  }

  // Read every note once, in one batch: the sibling list and the contents to
  // rewrite come from the same snapshot, and these round trips run while the
  // global mutation lock is held.
  const files = await store.listFiles(
    collection.sourceDir,
    collection.readExtensions,
  );
  const entries = entriesFromFiles(collection, files);
  const siblings = entries.filter(
    (entry) =>
      entry.folder === folder && !(folder === '' && entry.id === 'index'),
  );
  const expectedIds = new Set(siblings.map((entry) => entry.id));
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== siblings.length ||
    ids.some((id) => !expectedIds.has(id))
  ) {
    return adminJson(
      {
        error: 'Reorder ids must include every sibling entry exactly once.',
        code: 'invalid_reorder_ids',
      },
      { status: 400 },
    );
  }

  const byId = new Map(siblings.map((entry) => [entry.id, entry]));
  const writes: BatchTextWrite[] = [];
  const pathsById = new Map<string, string>();

  const filesByPath = new Map(files.map((file) => [file.path, file]));

  for (const [order, id] of ids.entries()) {
    const entry = byId.get(id)!;
    const file = filesByPath.get(entry.path);
    // Every id was just checked against the sibling list, and the whole request
    // holds the content mutation lock, so a file missing here is a genuine
    // disagreement about what the collection contains — not something to paper
    // over with `ok: false` while reordering everything around it.
    if (!file) return missingEntry();

    const parsed = parseContentDocument(file.content);
    parsed.fields[collection.orderField] = order;
    let validated: Record<string, unknown>;
    try {
      validated = validateFields(collection, parsed.fields);
    } catch (error) {
      return validationError(error);
    }
    writes.push({
      path: file.path,
      content: serializeContentDocument(validated, parsed.body),
      revision: file.revision,
    });
    pathsById.set(id, file.path);
  }

  // One unit. Reordering is a statement about the sequence as a whole, so a
  // partial application is not a smaller version of it — it is a different
  // order than either the one that was there or the one that was asked for.
  // Issuing a write per sibling could commit a prefix and then answer 409,
  // leaving the collection in that third state with no way for the client to
  // learn which part had landed.
  let written;
  try {
    written = await store.writeTextFiles(
      writes,
      `content: reorder ${collection.id}/${folder || 'root'}`,
    );
  } catch (error) {
    return contentConflictResponse(error);
  }

  return adminJson({
    reordered: ids.map((id) => ({
      id,
      ok: true,
      revision: written.revisions[pathsById.get(id)!],
    })),
  });
}
