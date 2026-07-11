import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { adminJson, withAdminSecurityHeaders } from '../admin/response';
import { readJsonBody, requestBodyErrorResponse } from '../community/body';
import { bodyToBlocks, blocksToBody } from './blocks';
import { getContentCollection, getContentCollections } from './registry';
import {
  entryFolderFromPath,
  entryIdFromPath,
  folderIdFromPath,
  isValidFolderPath,
  isValidSlug,
  normalizeFolderPath,
  sanitizeFilename,
  slugify,
  sourcePath,
} from './paths';
import { parseContentDocument, serializeContentDocument } from './serializers';
import {
  createPublishJob,
  deleteDraft,
  deleteMediaAsset,
  listDrafts,
  listMediaAssets,
  readContentHistory,
  readDraft,
  readPublishJob,
  readRevisionContent,
  writeDraft,
  writePublishJob,
} from './studio';
import {
  ContentFolderNotEmptyError,
  ContentRevisionConflictError,
} from './types';
import type {
  ContentBlock,
  ContentCollectionDefinition,
  ContentDraft,
  ContentEntryDetail,
  ContentEntryListItem,
  ContentFieldDefinition,
  ContentFolder,
  ContentProvider,
  ContentSourceFile,
  ContentWriteResult,
  PublishJob,
} from './types';

const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const execAsync = promisify(exec);
const ALLOWED_MEDIA_TYPES = new Set([
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/gif',
]);

interface SaveEntryBody {
  slug?: string;
  folder?: string;
  fields?: Record<string, unknown>;
  body?: string;
  revision?: string;
}

function publicCollection(collection: ContentCollectionDefinition) {
  return {
    id: collection.id,
    label: collection.label,
    singularLabel: collection.singularLabel,
    format: collection.format,
    body: collection.body,
    reorderable: collection.reorderable ?? false,
    routePattern: collection.routePattern,
    indexRoute: collection.indexRoute,
    supportsDrafts: collection.supportsDrafts,
    supportsBlocks: collection.supportsBlocks,
    supportsFolders: collection.supportsFolders ?? false,
    templates: collection.templates,
    surfaces: collection.surfaces,
    fields: collection.fields,
    media: {
      publicPath: collection.mediaPublicPath,
      groupByEntry: collection.groupMediaByEntry,
    },
  };
}

async function draftCountsByCollection(
  projectRoot: string | undefined,
): Promise<Map<string, number>> {
  if (!projectRoot) return new Map();

  const counts = new Map<string, number>();
  for (const draft of await listDrafts(projectRoot)) {
    counts.set(draft.collection, (counts.get(draft.collection) ?? 0) + 1);
  }
  return counts;
}

async function draftsForCollection(
  projectRoot: string | undefined,
  collectionId: string,
): Promise<ContentDraft[]> {
  if (!projectRoot) return [];
  return (await listDrafts(projectRoot)).filter(
    (draft) => draft.collection === collectionId,
  );
}

function notReorderable(): Response {
  return adminJson(
    {
      error: 'This collection does not support reordering.',
      code: 'not_reorderable',
    },
    { status: 400 },
  );
}

export async function handleContentReorder(
  provider: ContentProvider,
  collectionId: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!collection.reorderable || !collection.orderField)
    return notReorderable();

  let body: { ids?: unknown; folder?: unknown };
  try {
    body = await readJsonBody<{ ids?: unknown; folder?: unknown }>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : null;
  const folder = normalizeFolderPath(String(body.folder ?? ''));
  if (!ids || ids.length === 0 || ids.some((id) => !isValidSlug(id))) {
    return adminJson(
      {
        error: 'A non-empty array of valid entry ids is required.',
        code: 'invalid_ids',
      },
      { status: 400 },
    );
  }
  if (!isValidFolderPath(folder)) return badFolder();
  if (!(await folderExists(provider, collection, folder))) {
    return adminJson(
      { error: 'That folder no longer exists.', code: 'folder_not_found' },
      { status: 404 },
    );
  }

  const entries = await readCollectionEntries(provider, collection);
  const siblingEntries = entries.filter(
    (entry) =>
      entry.folder === folder && !(folder === '' && entry.id === 'index'),
  );
  const existingIds = new Set(siblingEntries.map((entry) => entry.id));
  const uniqueIds = new Set(ids);
  if (
    uniqueIds.size !== ids.length ||
    ids.length !== siblingEntries.length ||
    ids.some((id) => !existingIds.has(id))
  ) {
    return adminJson(
      {
        error: 'Reorder ids must include every sibling entry exactly once.',
        code: 'invalid_reorder_ids',
      },
      { status: 400 },
    );
  }

  const entriesById = new Map(siblingEntries.map((entry) => [entry.id, entry]));
  const orderField = collection.orderField;
  const results: { id: string; ok: boolean }[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]!;
    const path =
      entriesById.get(id)?.path ??
      sourcePath(collection.sourceDir, id, collection.extension);
    const existing = await provider.readFile(path);
    if (!existing) {
      results.push({ id, ok: false });
      continue;
    }

    const parsed = parseContentDocument(existing.content, collection.format);
    parsed.fields[orderField] = index;
    const next = serializeContentDocument(
      parsed.fields,
      collection.body ? parsed.body : '',
      collection.format,
    );
    try {
      await provider.writeTextFile(
        path,
        next,
        `content: reorder ${collection.id}/${id} -> ${index}`,
        existing.revision,
      );
    } catch (error) {
      const response = writeConflictResponse(error);
      if (response) return response;
      throw error;
    }
    results.push({ id, ok: true });
  }

  return adminJson({ reordered: results });
}

function fieldDefault(field: ContentFieldDefinition): unknown {
  if (field.type === 'boolean') return false;
  if (field.type === 'string-list') return [];
  if (field.type === 'integer') return undefined;
  return '';
}

function normalizeFields(
  collection: ContentCollectionDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    collection.fields.map((field) => {
      const value = input[field.name] ?? fieldDefault(field);

      if (field.type === 'boolean') {
        return [field.name, value === true];
      }
      if (field.type === 'integer') {
        if (value === '' || value === null || value === undefined) {
          return [field.name, undefined];
        }
        return [field.name, Number(value)];
      }
      if (field.type === 'string-list') {
        if (Array.isArray(value)) {
          return [
            field.name,
            value.map((item) => String(item).trim()).filter(Boolean),
          ];
        }
        return [
          field.name,
          String(value)
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean),
        ];
      }

      const text = String(value ?? '').trim();
      if (!field.required && text === '') return [field.name, undefined];
      return [field.name, text];
    }),
  );
}

function validationError(error: unknown): Response {
  const issues =
    error &&
    typeof error === 'object' &&
    'issues' in error &&
    Array.isArray(error.issues)
      ? error.issues
      : [];

  return adminJson(
    {
      error: 'Content validation failed.',
      code: 'validation_failed',
      issues,
    },
    { status: 400 },
  );
}

function writeConflictResponse(error: unknown): Response | null {
  const isRevisionConflict =
    error instanceof ContentRevisionConflictError ||
    (error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'revision_conflict');

  if (!isRevisionConflict) return null;

  return adminJson(
    {
      error:
        error instanceof Error
          ? error.message
          : 'This content changed since you opened it. Refresh and try again.',
      code: 'revision_conflict',
    },
    { status: 409 },
  );
}

function validateFields(
  collection: ContentCollectionDefinition,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return collection.schema.parse(normalizeFields(collection, fields));
}

function toListItem(
  collection: ContentCollectionDefinition,
  file: ContentSourceFile,
): ContentEntryListItem {
  const parsed = parseContentDocument(file.content, collection.format);
  const id = entryIdFromPath(file.path, collection.extension);
  return {
    id,
    title: titleFromFields(
      id,
      parsed.fields,
      collection.body ? parsed.body : undefined,
    ),
    folder: entryFolderFromPath(file.path, collection.sourceDir),
    path: file.path,
    revision: file.revision,
    meta: {
      draft: parsed.fields.draft,
      order: parsed.fields.order,
    },
  };
}

function toDetail(
  collection: ContentCollectionDefinition,
  file: ContentSourceFile,
): ContentEntryDetail {
  const parsed = parseContentDocument(file.content, collection.format);
  return {
    ...toListItem(collection, file),
    fields: parsed.fields,
    body: collection.body ? parsed.body : '',
  };
}

function sortEntries(entries: ContentEntryListItem[]): ContentEntryListItem[] {
  return entries.toSorted((left, right) => {
    const order =
      Number(left.meta.order ?? Number.MAX_SAFE_INTEGER) -
      Number(right.meta.order ?? Number.MAX_SAFE_INTEGER);
    if (order !== 0) return order;

    const leftDate = String(left.meta.updated ?? left.meta.created ?? '');
    const rightDate = String(right.meta.updated ?? right.meta.created ?? '');
    return (
      rightDate.localeCompare(leftDate) || left.title.localeCompare(right.title)
    );
  });
}

async function readCollectionEntries(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
): Promise<ContentEntryListItem[]> {
  const files = await provider.listFiles(
    collection.sourceDir,
    collection.extension,
  );
  return sortEntries(files.map((file) => toListItem(collection, file)));
}

async function findEntryFile(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  id: string,
): Promise<ContentSourceFile | null> {
  const files = await provider.listFiles(
    collection.sourceDir,
    collection.extension,
  );
  return (
    files.find(
      (file) => entryIdFromPath(file.path, collection.extension) === id,
    ) ?? null
  );
}

function folderName(id: string): string {
  return id.split('/').pop() ?? id;
}

async function readCollectionFolders(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  entries?: ContentEntryListItem[],
): Promise<ContentFolder[]> {
  if (!collection.supportsFolders) return [];

  const collectionEntries =
    entries ?? (await readCollectionEntries(provider, collection));
  const folderIds = new Set(
    (await provider.listDirectories(collection.sourceDir))
      .map((directory) => folderIdFromPath(directory, collection.sourceDir))
      .filter(Boolean),
  );

  for (const entry of collectionEntries) {
    let current = entry.folder;
    while (current) {
      folderIds.add(current);
      current = current.includes('/')
        ? current.slice(0, current.lastIndexOf('/'))
        : '';
    }
  }

  const directCounts = new Map<string, number>();
  for (const entry of collectionEntries) {
    directCounts.set(entry.folder, (directCounts.get(entry.folder) ?? 0) + 1);
  }

  return [...folderIds]
    .toSorted((left, right) => left.localeCompare(right))
    .map((id) => {
      const name = folderName(id);
      const parentId = id.includes('/')
        ? id.slice(0, id.lastIndexOf('/'))
        : null;
      const document = collectionEntries.find(
        (entry) => entry.id === name && entry.folder === (parentId ?? ''),
      );
      return {
        id,
        name,
        parentId,
        depth: id.split('/').length - 1,
        noteCount: directCounts.get(id) ?? 0,
        totalNoteCount: collectionEntries.filter(
          (entry) => entry.folder === id || entry.folder.startsWith(`${id}/`),
        ).length,
        documentId: document?.id,
      };
    });
}

function missingCollection(): Response {
  return adminJson(
    { error: 'Unknown content collection.', code: 'unknown_collection' },
    { status: 404 },
  );
}

function missingEntry(): Response {
  return adminJson(
    { error: 'Content entry was not found.', code: 'not_found' },
    { status: 404 },
  );
}

function badSlug(): Response {
  return adminJson(
    {
      error: 'Slug must use lowercase kebab-case.',
      code: 'invalid_slug',
    },
    { status: 400 },
  );
}

function badFolder(): Response {
  return adminJson(
    {
      error: 'Folder names must use lowercase letters, numbers, and hyphens.',
      code: 'invalid_folder',
    },
    { status: 400 },
  );
}

export async function handleContentCollections(
  provider: ContentProvider,
  projectRoot?: string,
): Promise<Response> {
  const draftCounts = await draftCountsByCollection(projectRoot);
  const collections = await Promise.all(
    getContentCollections().map(async (collection) => ({
      ...publicCollection(collection),
      count: (await readCollectionEntries(provider, collection)).length,
      drafts: draftCounts.get(collection.id) ?? 0,
    })),
  );

  return adminJson({ collections, provider: provider.kind });
}

export async function handleContentCollection(
  provider: ContentProvider,
  collectionId: string | undefined,
  request: Request,
  projectRoot?: string,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();

  if (request.method === 'GET') {
    const entries = await readCollectionEntries(provider, collection);
    const drafts = await draftsForCollection(projectRoot, collection.id);
    const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
    const folderEntries = entries
      .map((entry) => ({
        ...entry,
        folder: draftById.get(entry.id)?.folder ?? entry.folder,
      }))
      .concat(
        drafts
          .filter((draft) => !entries.some((entry) => entry.id === draft.id))
          .map((draft) => ({
            id: draft.id,
            title: draft.title,
            folder: draft.folder ?? '',
            path: draft.sourcePath,
            revision: draft.sourceRevision,
            meta: {},
          })),
      );
    return adminJson({
      collection: publicCollection(collection),
      entries,
      folders: await readCollectionFolders(provider, collection, folderEntries),
      drafts,
      provider: provider.kind,
    });
  }

  if (request.method !== 'POST') {
    return adminJson({ error: 'Method not allowed.' }, { status: 405 });
  }

  let body: SaveEntryBody;
  try {
    body = await readJsonBody<SaveEntryBody>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const fields = body.fields ?? {};
  const slug = body.slug?.trim() || slugify(String(fields.title ?? ''));
  if (!isValidSlug(slug)) return badSlug();
  const folder = normalizeFolderPath(body.folder ?? '');
  if (!isValidFolderPath(folder)) return badFolder();

  const existingEntries = await readCollectionEntries(provider, collection);
  if (existingEntries.some((entry) => entry.id === slug)) {
    return adminJson(
      { error: 'A content entry already uses that slug.', code: 'slug_exists' },
      { status: 409 },
    );
  }
  const path = sourcePath(
    collection.sourceDir,
    slug,
    collection.extension,
    folder,
  );

  let validatedFields: Record<string, unknown>;
  try {
    validatedFields = validateFields(collection, fields);
  } catch (error) {
    return validationError(error);
  }

  const message = `content: create ${collection.id}/${slug}`;
  let result: ContentWriteResult;
  try {
    result = await provider.writeTextFile(
      path,
      serializeContentDocument(
        validatedFields,
        collection.body ? String(body.body ?? '') : '',
        collection.format,
      ),
      message,
    );
  } catch (error) {
    const response = writeConflictResponse(error);
    if (response) return response;
    throw error;
  }
  const saved = await provider.readFile(path);

  return adminJson(
    {
      entry: saved ? toDetail(collection, saved) : null,
      result,
    },
    { status: 201 },
  );
}

export async function handleContentEntry(
  provider: ContentProvider,
  collectionId: string | undefined,
  id: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!id || !isValidSlug(id)) return badSlug();

  const existing = await findEntryFile(provider, collection, id);
  if (!existing) return missingEntry();
  const path = existing.path;

  if (request.method === 'GET') {
    return adminJson({
      collection: publicCollection(collection),
      entry: toDetail(collection, existing),
      provider: provider.kind,
    });
  }

  if (request.method === 'DELETE') {
    let result: ContentWriteResult;
    try {
      result = await provider.deleteFile(
        path,
        `content: delete ${collection.id}/${id}`,
        existing.revision,
      );
    } catch (error) {
      const response = writeConflictResponse(error);
      if (response) return response;
      throw error;
    }
    return adminJson({ result });
  }

  if (request.method !== 'PUT') {
    return adminJson({ error: 'Method not allowed.' }, { status: 405 });
  }

  let body: SaveEntryBody;
  try {
    body = await readJsonBody<SaveEntryBody>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  let validatedFields: Record<string, unknown>;
  try {
    validatedFields = validateFields(collection, body.fields ?? {});
  } catch (error) {
    return validationError(error);
  }

  let result: ContentWriteResult;
  try {
    result = await provider.writeTextFile(
      path,
      serializeContentDocument(
        validatedFields,
        collection.body ? String(body.body ?? '') : '',
        collection.format,
      ),
      `content: update ${collection.id}/${id}`,
      body.revision ?? existing.revision,
    );
  } catch (error) {
    const response = writeConflictResponse(error);
    if (response) return response;
    throw error;
  }
  const saved = await provider.readFile(path);

  return adminJson({
    entry: saved ? toDetail(collection, saved) : null,
    result,
  });
}

function folderRepositoryPath(
  collection: ContentCollectionDefinition,
  folder: string,
): string {
  return `${collection.sourceDir}/${normalizeFolderPath(folder)}`;
}

function parentFolder(folder: string): string {
  const normalized = normalizeFolderPath(folder);
  return normalized.includes('/')
    ? normalized.slice(0, normalized.lastIndexOf('/'))
    : '';
}

function folderDocumentPath(
  collection: ContentCollectionDefinition,
  folder: string,
): string {
  return sourcePath(
    collection.sourceDir,
    folderName(folder),
    collection.extension,
    parentFolder(folder),
  );
}

function folderDocumentBody(folder: string): string {
  return `# ${folderName(folder).replaceAll('-', ' ')}\n`;
}

async function ensureFolderDocument(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  folder: string,
): Promise<ContentSourceFile> {
  const path = folderDocumentPath(collection, folder);
  const existing = await provider.readFile(path);
  if (existing) return existing;

  await provider.writeTextFile(
    path,
    serializeContentDocument(
      validateFields(collection, { draft: false }),
      collection.body ? folderDocumentBody(folder) : '',
      collection.format,
    ),
    `content: create folder page ${collection.id}/${folder}`,
  );
  return (await provider.readFile(path))!;
}

async function folderExists(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  folder: string,
): Promise<boolean> {
  if (!folder) return true;
  const repositoryPath = folderRepositoryPath(collection, folder);
  return (await provider.listDirectories(collection.sourceDir)).includes(
    repositoryPath,
  );
}

async function updateDraftFoldersAfterMove(
  projectRoot: string | undefined,
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  previousFolder: string,
  nextFolder: string,
): Promise<void> {
  if (!projectRoot) return;
  const drafts = (await listDrafts(projectRoot)).filter(
    (draft) =>
      draft.collection === collection.id &&
      (draft.folder === previousFolder ||
        draft.folder?.startsWith(`${previousFolder}/`)),
  );

  await Promise.all(
    drafts.map(async (draft) => {
      const suffix = (draft.folder ?? '').slice(previousFolder.length);
      const folder = `${nextFolder}${suffix}`.replace(/^\/+|\/+$/g, '');
      const source = await findEntryFile(provider, collection, draft.id);
      await writeDraft(projectRoot, {
        ...draft,
        folder,
        sourcePath: sourcePath(
          collection.sourceDir,
          draft.id,
          collection.extension,
          folder,
        ),
        sourceRevision: source?.revision ?? draft.sourceRevision,
      });
    }),
  );
}

async function updateFolderDocumentDraftAfterMove(
  projectRoot: string | undefined,
  collection: ContentCollectionDefinition,
  previousFolder: string,
  nextFolder: string,
  sourceRevision?: string,
): Promise<void> {
  if (!projectRoot) return;
  const previousId = folderName(previousFolder);
  const nextId = folderName(nextFolder);
  const draft = await readDraft(projectRoot, collection.id, previousId);
  if (!draft || draft.folder !== parentFolder(previousFolder)) return;

  await writeDraft(projectRoot, {
    ...draft,
    id: nextId,
    folder: parentFolder(nextFolder),
    sourcePath: folderDocumentPath(collection, nextFolder),
    sourceRevision: sourceRevision ?? draft.sourceRevision,
  });
  if (nextId !== previousId) {
    await deleteDraft(projectRoot, collection.id, previousId);
  }
}

function nextSiblingOrder(
  entries: ContentEntryListItem[],
  folder: string,
): number {
  const orders = entries
    .filter((entry) => entry.folder === folder)
    .map((entry) => Number(entry.meta.order))
    .filter(Number.isFinite);
  return orders.length > 0 ? Math.max(...orders) + 1 : 0;
}

function contentWithOrder(
  collection: ContentCollectionDefinition,
  content: string,
  order: number,
): string {
  if (!collection.orderField) return content;
  const parsed = parseContentDocument(content, collection.format);
  parsed.fields[collection.orderField] = order;
  return serializeContentDocument(
    parsed.fields,
    collection.body ? parsed.body : '',
    collection.format,
  );
}

function uniqueContentId(base: string, reserved: Set<string>): string {
  let candidate = slugify(base) || 'copy';
  let suffix = 2;
  while (reserved.has(candidate)) {
    candidate = `${slugify(base) || 'copy'}-${suffix}`;
    suffix += 1;
  }
  reserved.add(candidate);
  return candidate;
}

async function duplicateFolderTree(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  sourceFolder: string,
  destinationFolder: string,
): Promise<void> {
  const entries = await readCollectionEntries(provider, collection);
  const reservedIds = new Set(entries.map((entry) => entry.id));
  const destinationId = folderName(destinationFolder);
  if (reservedIds.has(destinationId)) {
    throw Object.assign(new Error('A note already uses that folder name.'), {
      code: 'slug_exists',
    });
  }
  reservedIds.add(destinationId);

  const directories = (await provider.listDirectories(collection.sourceDir))
    .map((directory) => folderIdFromPath(directory, collection.sourceDir))
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

  await provider.createDirectory(
    folderRepositoryPath(collection, destinationFolder),
    `content: duplicate folder ${collection.id}/${sourceFolder}`,
  );

  for (const sourceDirectory of sourceDirectories.slice(1)) {
    const destinationParent = destinationBySource.get(
      parentFolder(sourceDirectory),
    )!;
    const destinationName = uniqueContentId(
      `${folderName(sourceDirectory)}-copy`,
      reservedIds,
    );
    const destinationDirectory = [destinationParent, destinationName]
      .filter(Boolean)
      .join('/');
    destinationBySource.set(sourceDirectory, destinationDirectory);
    await provider.createDirectory(
      folderRepositoryPath(collection, destinationDirectory),
      `content: duplicate folder ${collection.id}/${sourceDirectory}`,
    );
  }

  const sourcePage = await provider.readFile(
    folderDocumentPath(collection, sourceFolder),
  );
  if (sourcePage) {
    await provider.writeTextFile(
      folderDocumentPath(collection, destinationFolder),
      contentWithOrder(
        collection,
        sourcePage.content,
        nextSiblingOrder(entries, parentFolder(destinationFolder)),
      ),
      `content: duplicate folder page ${collection.id}/${sourceFolder}`,
    );
  } else {
    await ensureFolderDocument(provider, collection, destinationFolder);
  }

  const sourceDirectorySet = new Set(sourceDirectories);
  for (const entry of entries) {
    if (
      entry.folder !== sourceFolder &&
      !entry.folder.startsWith(`${sourceFolder}/`)
    ) {
      continue;
    }

    const source = await provider.readFile(entry.path);
    if (!source) continue;
    const childFolder = [entry.folder, entry.id].filter(Boolean).join('/');
    const mappedChildFolder = destinationBySource.get(childFolder);
    const destinationEntryFolder = mappedChildFolder
      ? parentFolder(mappedChildFolder)
      : destinationBySource.get(entry.folder)!;
    const destinationEntryId = mappedChildFolder
      ? folderName(mappedChildFolder)
      : uniqueContentId(`${entry.id}-copy`, reservedIds);

    await provider.writeTextFile(
      sourcePath(
        collection.sourceDir,
        destinationEntryId,
        collection.extension,
        destinationEntryFolder,
      ),
      source.content,
      `content: duplicate ${collection.id}/${entry.id}`,
    );
    if (sourceDirectorySet.has(childFolder) && !mappedChildFolder) {
      throw new Error(`Could not map duplicated folder ${childFolder}.`);
    }
  }
}

export async function handleContentFolders(
  provider: ContentProvider,
  collectionId: string | undefined,
  request: Request,
  projectRoot?: string,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!collection.supportsFolders) {
    return adminJson(
      { error: 'This collection does not use folders.', code: 'no_folders' },
      { status: 400 },
    );
  }

  if (request.method === 'GET') {
    return adminJson({
      folders: await readCollectionFolders(provider, collection),
    });
  }

  let body: { path?: unknown; nextPath?: unknown; copyFrom?: unknown };
  try {
    body = await readJsonBody<{
      path?: unknown;
      nextPath?: unknown;
      copyFrom?: unknown;
    }>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const folder = normalizeFolderPath(String(body.path ?? ''));
  if (!folder || !isValidFolderPath(folder, false)) return badFolder();

  if (request.method === 'POST') {
    if (await folderExists(provider, collection, folder)) {
      return adminJson(
        { error: 'That folder already exists.', code: 'folder_exists' },
        { status: 409 },
      );
    }
    const copyFrom = normalizeFolderPath(String(body.copyFrom ?? ''));
    if (copyFrom) {
      if (!isValidFolderPath(copyFrom, false)) return badFolder();
      if (!(await folderExists(provider, collection, parentFolder(folder)))) {
        return adminJson(
          {
            error: 'Choose a folder that still exists.',
            code: 'folder_not_found',
          },
          { status: 404 },
        );
      }
      if (!(await folderExists(provider, collection, copyFrom))) {
        return adminJson(
          { error: 'That folder no longer exists.', code: 'folder_not_found' },
          { status: 404 },
        );
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
        await duplicateFolderTree(provider, collection, copyFrom, folder);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'slug_exists'
        ) {
          return adminJson(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'A note already uses that folder name.',
              code: 'slug_exists',
            },
            { status: 409 },
          );
        }
        throw error;
      }
      return adminJson(
        {
          folders: await readCollectionFolders(provider, collection),
          duplicated: folder,
        },
        { status: 201 },
      );
    }

    const result = await provider.createDirectory(
      folderRepositoryPath(collection, folder),
      `content: create folder ${collection.id}/${folder}`,
    );
    await ensureFolderDocument(provider, collection, folder);
    return adminJson(
      {
        folders: await readCollectionFolders(provider, collection),
        result,
      },
      { status: 201 },
    );
  }

  if (request.method === 'PATCH') {
    const nextFolder = normalizeFolderPath(String(body.nextPath ?? ''));
    if (!nextFolder || !isValidFolderPath(nextFolder, false)) {
      return badFolder();
    }
    if (nextFolder === folder) {
      return adminJson({
        folders: await readCollectionFolders(provider, collection),
      });
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
    if (!(await folderExists(provider, collection, parentFolder(nextFolder)))) {
      return adminJson(
        {
          error: 'Choose a folder that still exists.',
          code: 'folder_not_found',
        },
        { status: 404 },
      );
    }
    if (!(await folderExists(provider, collection, folder))) {
      return adminJson(
        { error: 'That folder no longer exists.', code: 'folder_not_found' },
        { status: 404 },
      );
    }
    if (await folderExists(provider, collection, nextFolder)) {
      return adminJson(
        { error: 'That folder already exists.', code: 'folder_exists' },
        { status: 409 },
      );
    }

    const previousPagePath = folderDocumentPath(collection, folder);
    const nextPagePath = folderDocumentPath(collection, nextFolder);
    const entries = await readCollectionEntries(provider, collection);
    const conflictingEntry = entries.find(
      (entry) =>
        entry.id === folderName(nextFolder) && entry.path !== previousPagePath,
    );
    if (conflictingEntry || (await provider.readFile(nextPagePath))) {
      return adminJson(
        { error: 'A note already uses that folder name.', code: 'slug_exists' },
        { status: 409 },
      );
    }

    const result = await provider.movePath(
      folderRepositoryPath(collection, folder),
      folderRepositoryPath(collection, nextFolder),
      `content: move folder ${collection.id}/${folder} to ${nextFolder}`,
    );
    const previousPage = await provider.readFile(previousPagePath);
    let nextPage: ContentSourceFile;
    if (previousPage) {
      await provider.movePath(
        previousPagePath,
        nextPagePath,
        `content: move folder page ${collection.id}/${folder} to ${nextFolder}`,
        previousPage.revision,
      );
      nextPage = (await provider.readFile(nextPagePath))!;
    } else {
      nextPage = await ensureFolderDocument(provider, collection, nextFolder);
    }
    await updateDraftFoldersAfterMove(
      projectRoot,
      provider,
      collection,
      folder,
      nextFolder,
    );
    await updateFolderDocumentDraftAfterMove(
      projectRoot,
      collection,
      folder,
      nextFolder,
      nextPage.revision,
    );
    return adminJson({
      folders: await readCollectionFolders(provider, collection),
      result,
    });
  }

  if (request.method === 'DELETE') {
    if (!(await folderExists(provider, collection, folder))) {
      return adminJson(
        { error: 'That folder no longer exists.', code: 'folder_not_found' },
        { status: 404 },
      );
    }
    const hasDrafts = projectRoot
      ? (await listDrafts(projectRoot)).some(
          (draft) =>
            draft.collection === collection.id &&
            (draft.folder === folder || draft.folder?.startsWith(`${folder}/`)),
        )
      : false;
    if (hasDrafts) {
      return adminJson(
        {
          error: 'Move the draft notes out of this folder before deleting it.',
          code: 'folder_not_empty',
        },
        { status: 409 },
      );
    }
    try {
      const result = await provider.deleteDirectory(
        folderRepositoryPath(collection, folder),
        `content: delete folder ${collection.id}/${folder}`,
      );
      const pagePath = folderDocumentPath(collection, folder);
      const page = await provider.readFile(pagePath);
      if (page) {
        await provider.deleteFile(
          pagePath,
          `content: delete folder page ${collection.id}/${folder}`,
          page.revision,
        );
      }
      if (projectRoot) {
        await deleteDraft(projectRoot, collection.id, folderName(folder));
      }
      return adminJson({
        folders: await readCollectionFolders(provider, collection),
        result,
      });
    } catch (error) {
      if (
        error instanceof ContentFolderNotEmptyError ||
        (error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'folder_not_empty')
      ) {
        return adminJson(
          {
            error: 'Move the notes out of this folder before deleting it.',
            code: 'folder_not_empty',
          },
          { status: 409 },
        );
      }
      throw error;
    }
  }

  return adminJson({ error: 'Method not allowed.' }, { status: 405 });
}

export async function handleContentMove(
  provider: ContentProvider,
  collectionId: string | undefined,
  request: Request,
  projectRoot?: string,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (request.method !== 'POST') {
    return adminJson({ error: 'Method not allowed.' }, { status: 405 });
  }

  let body: {
    id?: unknown;
    folder?: unknown;
    nextId?: unknown;
    operation?: unknown;
  };
  try {
    body = await readJsonBody<{
      id?: unknown;
      folder?: unknown;
      nextId?: unknown;
      operation?: unknown;
    }>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const id = String(body.id ?? '');
  const nextId = String(body.nextId ?? id);
  const folder = normalizeFolderPath(String(body.folder ?? ''));
  const operation = body.operation === 'duplicate' ? 'duplicate' : 'move';
  if (!isValidSlug(id)) return badSlug();
  if (!isValidSlug(nextId)) return badSlug();
  if (!isValidFolderPath(folder)) return badFolder();
  if (id === 'index' && (nextId !== 'index' || folder !== '')) {
    return adminJson(
      {
        error: 'The Notes root cannot be moved or renamed.',
        code: 'root_entry',
      },
      { status: 400 },
    );
  }
  if (!(await folderExists(provider, collection, folder))) {
    return adminJson(
      { error: 'Choose a folder that still exists.', code: 'folder_not_found' },
      { status: 404 },
    );
  }

  const existing = await findEntryFile(provider, collection, id);
  if (!existing) return missingEntry();
  const entries = await readCollectionEntries(provider, collection);
  if (nextId !== id && entries.some((entry) => entry.id === nextId)) {
    return adminJson(
      { error: 'A note already uses that file name.', code: 'slug_exists' },
      { status: 409 },
    );
  }
  const currentFolder = entryFolderFromPath(
    existing.path,
    collection.sourceDir,
  );
  if (operation === 'duplicate' && nextId === id) {
    return adminJson(
      { error: 'Choose a new file name for the copy.', code: 'slug_exists' },
      { status: 409 },
    );
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
  if (await provider.readFile(nextPath)) {
    return adminJson(
      { error: 'A note already uses that path.', code: 'path_exists' },
      { status: 409 },
    );
  }

  if (operation === 'duplicate') {
    const result = await provider.writeTextFile(
      nextPath,
      contentWithOrder(
        collection,
        existing.content,
        nextSiblingOrder(entries, folder),
      ),
      `content: duplicate ${collection.id}/${id} as ${nextId}`,
    );
    const duplicated = await provider.readFile(nextPath);
    if (projectRoot) {
      const draft = await readDraft(projectRoot, collection.id, id);
      if (draft) {
        await writeDraft(projectRoot, {
          ...draft,
          id: nextId,
          folder,
          sourcePath: nextPath,
          sourceRevision: duplicated?.revision,
          isNew: false,
        });
      }
    }
    return adminJson({
      entry: duplicated ? toDetail(collection, duplicated) : null,
      result,
    });
  }

  const result = await provider.movePath(
    existing.path,
    nextPath,
    `content: move ${collection.id}/${id} to ${folder || 'root'}/${nextId}`,
    existing.revision,
  );
  const moved = await provider.readFile(nextPath);
  if (projectRoot) {
    const draft = await readDraft(projectRoot, collection.id, id);
    if (draft) {
      await writeDraft(projectRoot, {
        ...draft,
        id: nextId,
        folder,
        sourcePath: nextPath,
        sourceRevision: moved?.revision ?? draft.sourceRevision,
      });
      if (nextId !== id) {
        await deleteDraft(projectRoot, collection.id, id);
      }
    }
  }

  return adminJson({
    entry: moved ? toDetail(collection, moved) : null,
    result,
  });
}

export async function handleContentMedia(
  provider: ContentProvider,
  request: Request,
  projectRoot?: string,
): Promise<Response> {
  if (request.method === 'GET') {
    if (!projectRoot) {
      return adminJson({ media: [] });
    }
    return adminJson({ media: await listMediaAssets(projectRoot) });
  }

  if (request.method === 'DELETE') {
    if (!projectRoot) {
      return adminJson(
        { error: 'Media deletion is unavailable.', code: 'media_unavailable' },
        { status: 503 },
      );
    }

    let body: { url?: unknown };
    try {
      body = await readJsonBody<{ url?: unknown }>(request);
    } catch (error) {
      return requestBodyErrorResponse(error);
    }

    const url = String(body.url ?? '');
    await deleteMediaAsset(projectRoot, url);
    return adminJson({ deleted: url });
  }

  if (request.method !== 'POST') {
    return adminJson({ error: 'Method not allowed.' }, { status: 405 });
  }

  const formData = await request.formData();
  const collection = getContentCollection(
    String(formData.get('collection') ?? ''),
  );
  if (!collection) return missingCollection();

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return adminJson(
      { error: 'Missing upload file.', code: 'missing_file' },
      { status: 400 },
    );
  }
  if (!ALLOWED_MEDIA_TYPES.has(file.type)) {
    return adminJson(
      { error: 'Unsupported image type.', code: 'unsupported_media_type' },
      { status: 400 },
    );
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return adminJson(
      { error: 'Image upload is too large.', code: 'payload_too_large' },
      { status: 413 },
    );
  }

  const entryId = String(formData.get('entryId') ?? '').trim();
  const folder =
    collection.groupMediaByEntry && isValidSlug(entryId) ? entryId : 'uploads';
  const filename = sanitizeFilename(file.name);
  const path = `${collection.mediaDir}/${folder}/${filename}`;
  const publicUrl = `${collection.mediaPublicPath}/${folder}/${filename}`;
  const result = await provider.writeBinaryFile(
    path,
    new Uint8Array(await file.arrayBuffer()),
    `content: upload media ${publicUrl}`,
  );

  return adminJson(
    {
      media: { url: publicUrl, path },
      result,
    },
    { status: 201 },
  );
}

function routePathFor(collection: ContentCollectionDefinition, id: string) {
  return collection.routePattern.replace(':id', id);
}

function routeMatchesPath(routePath: string, requestedPath: string): boolean {
  const normalizedRoute = routePath.split('#')[0] || '/';
  const normalizedRequested = requestedPath.split('#')[0] || '/';
  return normalizedRoute === normalizedRequested;
}

// The title is whatever heading the note opens with, falling back to legacy
// title frontmatter and then the file name. There is no title field to author.
function titleFromFields(
  id: string,
  fields: Record<string, unknown>,
  body?: string,
): string {
  const heading = body?.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  if (heading) return heading;
  const legacy = typeof fields.title === 'string' ? fields.title.trim() : '';
  return legacy || id;
}

function draftFromDocument(args: {
  collection: ContentCollectionDefinition;
  id: string;
  folder: string;
  fields: Record<string, unknown>;
  body: string;
  revision?: string;
  isNew: boolean;
}): ContentDraft {
  const now = new Date().toISOString();
  return {
    collection: args.collection.id,
    id: args.id,
    title: titleFromFields(args.id, args.fields, args.body),
    folder: args.folder,
    sourcePath: sourcePath(
      args.collection.sourceDir,
      args.id,
      args.collection.extension,
      args.folder,
    ),
    sourceRevision: args.revision,
    fields: args.fields,
    body: args.body,
    blocks: args.collection.supportsBlocks ? bodyToBlocks(args.body) : [],
    isNew: args.isNew,
    createdAt: now,
    updatedAt: now,
  };
}

function draftFromFile(
  collection: ContentCollectionDefinition,
  file: ContentSourceFile,
): ContentDraft {
  const parsed = parseContentDocument(file.content, collection.format);
  return draftFromDocument({
    collection,
    id: entryIdFromPath(file.path, collection.extension),
    folder: entryFolderFromPath(file.path, collection.sourceDir),
    fields: parsed.fields,
    body: collection.body ? parsed.body : '',
    revision: file.revision,
    isNew: false,
  });
}

interface DraftRequestBody {
  folder?: string;
  fields?: Record<string, unknown>;
  body?: string;
  blocks?: ContentBlock[];
  sourceRevision?: string;
  isNew?: boolean;
}

function draftFromRequestBody(
  collection: ContentCollectionDefinition,
  id: string,
  body: DraftRequestBody,
  existing: ContentSourceFile | null,
): ContentDraft {
  const fields = validateFields(collection, body.fields ?? {});
  const folder = normalizeFolderPath(
    body.folder ??
      (existing
        ? entryFolderFromPath(existing.path, collection.sourceDir)
        : ''),
  );
  if (!isValidFolderPath(folder)) throw new Error('Invalid folder path.');
  const blocks = Array.isArray(body.blocks) ? body.blocks : undefined;
  const bodyText = collection.body
    ? blocks
      ? blocksToBody(blocks)
      : String(body.body ?? '')
    : '';

  return {
    ...draftFromDocument({
      collection,
      id,
      folder,
      fields,
      body: bodyText,
      revision: body.sourceRevision ?? existing?.revision,
      isNew: body.isNew ?? !existing,
    }),
    blocks: collection.supportsBlocks ? (blocks ?? bodyToBlocks(bodyText)) : [],
  };
}

export async function handleContentDraft(
  projectRoot: string,
  provider: ContentProvider,
  collectionId: string | undefined,
  id: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!id || !isValidSlug(id)) return badSlug();

  const existing = await findEntryFile(provider, collection, id);

  if (request.method === 'GET') {
    return adminJson({
      draft: await readDraft(projectRoot, collection.id, id),
      source: existing ? toDetail(collection, existing) : null,
      provider: provider.kind,
    });
  }

  if (request.method === 'DELETE') {
    await deleteDraft(projectRoot, collection.id, id);
    return adminJson({ deleted: true });
  }

  if (request.method !== 'PUT') {
    return adminJson({ error: 'Method not allowed.' }, { status: 405 });
  }

  let draftBody: DraftRequestBody;
  try {
    draftBody = await readJsonBody<DraftRequestBody>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  let draft: ContentDraft;
  try {
    draft = draftFromRequestBody(collection, id, draftBody, existing);
  } catch (error) {
    return validationError(error);
  }

  return adminJson({ draft: await writeDraft(projectRoot, draft) });
}

export async function handleContentSurfaces(
  projectRoot: string,
  provider: ContentProvider,
  request: Request,
): Promise<Response> {
  const requestedPath = new URL(request.url).searchParams.get('path');
  const drafts = await listDrafts(projectRoot);
  const surfaces = [];

  for (const collection of getContentCollections()) {
    const entries = await readCollectionEntries(provider, collection);
    const publishedIds = new Set(entries.map((entry) => entry.id));

    for (const entry of entries) {
      const routePath = routePathFor(collection, entry.id);
      if (requestedPath && !routeMatchesPath(routePath, requestedPath)) {
        continue;
      }
      surfaces.push({
        id: `${collection.id}:${entry.id}`,
        collection: collection.id,
        entryId: entry.id,
        routePath,
        label: entry.title,
        regions: collection.surfaces,
      });
    }

    for (const draft of drafts.filter(
      (item) => item.collection === collection.id && !publishedIds.has(item.id),
    )) {
      const routePath = routePathFor(collection, draft.id);
      if (requestedPath && !routeMatchesPath(routePath, requestedPath)) {
        continue;
      }
      surfaces.push({
        id: `${collection.id}:${draft.id}`,
        collection: collection.id,
        entryId: draft.id,
        routePath,
        label: `${draft.title} (draft)`,
        regions: collection.surfaces,
      });
    }
  }

  return adminJson({ surfaces });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render [[wiki-links]] as links, matching the site's remark plugin, so the
// preview reflects the published page.
function inlinePreview(value: unknown): string {
  return escapeHtml(value).replace(
    /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
    (_match, target: string, label?: string) => {
      const slug = target
        .trim()
        .toLowerCase()
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return `<a class="wiki-link" href="/notes/${slug}">${(label ?? target).trim()}</a>`;
    },
  );
}

function previewBlockHtml(block: ContentBlock): string {
  if (block.type === 'heading') {
    const level = Math.min(Math.max(block.level ?? 2, 1), 3);
    return `<h${level}>${inlinePreview(block.value)}</h${level}>`;
  }
  if (block.type === 'image') {
    return `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(
      block.alt,
    )}" /><figcaption>${escapeHtml(block.alt)}</figcaption></figure>`;
  }
  if (block.type === 'code') {
    return `<pre><code>${escapeHtml(block.value)}</code></pre>`;
  }
  if (block.type === 'callout') {
    return `<aside><strong>${escapeHtml(block.title ?? 'Note')}</strong><p>${escapeHtml(
      block.value,
    )}</p></aside>`;
  }
  if (block.type === 'raw-mdx') {
    return `<pre class="raw-mdx">${escapeHtml(block.value)}</pre>`;
  }
  return `<p>${inlinePreview(block.value)}</p>`;
}

function previewHtml(
  collection: ContentCollectionDefinition,
  document: ContentDraft,
): string {
  const title = titleFromFields(document.id, document.fields, document.body);
  const blocks =
    document.blocks.length > 0
      ? document.blocks
      : bodyToBlocks(document.body ?? '');
  const bodyHtml = collection.supportsBlocks
    ? blocks.map(previewBlockHtml).join('\n')
    : '';

  // The preview mirrors the real page: the body is the whole thing, no template
  // wrapped around it.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} preview</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #0c0e11; color: #e4e8ee; }
    body { margin: 0; padding: 40px 20px; }
    main { width: min(760px, 100%); margin: 0 auto; }
    h1 { font-size: clamp(2rem, 7vw, 4rem); line-height: 1.05; }
    p, li { line-height: 1.75; color: #c2c8d2; }
    a { color: #7aa6cb; }
    img { max-width: 100%; border-radius: 8px; }
    pre, aside { border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 14px; background: rgba(255,255,255,.05); overflow: auto; }
  </style>
</head>
<body>
  <main>
    <article>${bodyHtml}</article>
  </main>
</body>
</html>`;
}

export async function handleContentPreview(
  projectRoot: string,
  provider: ContentProvider,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  let collectionId = url.searchParams.get('collection') ?? undefined;
  let id = url.searchParams.get('id') ?? undefined;
  let document: ContentDraft | null = null;

  if (request.method === 'POST') {
    let body: DraftRequestBody & { collection?: string; id?: string };
    try {
      body = await readJsonBody<
        DraftRequestBody & { collection?: string; id?: string }
      >(request);
    } catch (error) {
      return requestBodyErrorResponse(error);
    }
    collectionId = body.collection;
    id = body.id;
    const collection = getContentCollection(collectionId);
    if (!collection) return missingCollection();
    if (!id || !isValidSlug(id)) return badSlug();
    const existing = await findEntryFile(provider, collection, id);

    try {
      document = draftFromRequestBody(collection, id, body, existing);
    } catch (error) {
      return validationError(error);
    }
  } else {
    if (request.method !== 'GET') {
      return adminJson({ error: 'Method not allowed.' }, { status: 405 });
    }
  }

  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!id || !isValidSlug(id)) return badSlug();

  if (!document) {
    document = await readDraft(projectRoot, collection.id, id);
  }

  if (!document) {
    const file = await findEntryFile(provider, collection, id);
    if (!file) return missingEntry();
    document = draftFromFile(collection, file);
  }

  return withAdminSecurityHeaders(
    new Response(previewHtml(collection, document), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  );
}

function setJobStep(
  job: PublishJob,
  label: string,
  status: PublishJob['steps'][number]['status'],
  detail?: string,
): PublishJob {
  return {
    ...job,
    status: status === 'failed' ? 'failed' : job.status,
    steps: job.steps.map((step) =>
      step.label === label ? { ...step, status, detail } : step,
    ),
  };
}

async function runCommand(
  projectRoot: string,
  command: string,
): Promise<string> {
  const { stdout, stderr } = await execAsync(command, {
    cwd: projectRoot,
    timeout: 10 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return [stdout, stderr].filter(Boolean).join('\n').trim();
}

async function updateJobStep(
  projectRoot: string,
  job: PublishJob,
  label: string,
  status: PublishJob['steps'][number]['status'],
  detail?: string,
): Promise<PublishJob> {
  return writePublishJob(projectRoot, setJobStep(job, label, status, detail));
}

interface PublishRequestBody {
  collection?: string;
  id?: string;
  runChecks?: boolean;
  commit?: boolean;
  push?: boolean;
  deploy?: boolean;
}

export async function handleContentPublish(
  projectRoot: string,
  provider: ContentProvider,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return adminJson({ error: 'Method not allowed.' }, { status: 405 });
  }

  let body: PublishRequestBody;
  try {
    body = await readJsonBody<PublishRequestBody>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const collection = getContentCollection(body.collection);
  if (!collection) return missingCollection();
  const id = body.id;
  if (!id || !isValidSlug(id)) return badSlug();

  const draft = await readDraft(projectRoot, collection.id, id);
  if (!draft) {
    return adminJson(
      { error: 'No draft exists for this entry.', code: 'missing_draft' },
      { status: 404 },
    );
  }

  const shouldCommit = body.commit || body.push || body.deploy;
  const shouldPush = body.push || body.deploy;
  const stepLabels = [
    'Validate draft',
    'Write content files',
    body.runChecks ? 'Run checks' : 'Run checks',
    shouldCommit ? 'Commit content' : 'Commit content',
    shouldPush ? 'Push branch' : 'Push branch',
    body.deploy ? 'Deploy site' : 'Deploy site',
  ];
  let job = await writePublishJob(
    projectRoot,
    createPublishJob(collection.id, id, stepLabels),
  );

  try {
    job = { ...job, status: 'running' };
    job = await writePublishJob(projectRoot, job);

    job = await updateJobStep(projectRoot, job, 'Validate draft', 'running');
    const fields = validateFields(collection, draft.fields);
    // Publish the draft's Markdown verbatim. Re-serializing from `blocks`
    // is lossy: bodyToBlocks splits on blank lines (shredding fenced code
    // that contains one) and rewrites a plain `>` quote as a [!NOTE] callout.
    const bodyText = collection.body
      ? (draft.body ?? blocksToBody(draft.blocks))
      : '';
    job = await updateJobStep(projectRoot, job, 'Validate draft', 'succeeded');

    job = await updateJobStep(
      projectRoot,
      job,
      'Write content files',
      'running',
    );
    const folder = normalizeFolderPath(draft.folder ?? '');
    if (!isValidFolderPath(folder)) throw new Error('Invalid folder path.');
    const path = sourcePath(
      collection.sourceDir,
      id,
      collection.extension,
      folder,
    );
    let existing = await findEntryFile(provider, collection, id);
    if (draft.isNew && existing) {
      throw new ContentRevisionConflictError();
    }
    let writeRevision = existing
      ? (draft.sourceRevision ?? existing.revision)
      : undefined;
    if (existing && existing.path !== path) {
      if (await provider.readFile(path)) {
        throw new ContentRevisionConflictError();
      }
      await provider.movePath(
        existing.path,
        path,
        `content: move ${collection.id}/${id} to ${folder || 'root'}`,
        writeRevision,
      );
      existing = await provider.readFile(path);
      writeRevision = existing?.revision;
    }
    const result = await provider.writeTextFile(
      path,
      serializeContentDocument(fields, bodyText, collection.format),
      `content: publish ${collection.id}/${id}`,
      writeRevision,
    );
    await deleteDraft(projectRoot, collection.id, id);
    job = await updateJobStep(
      projectRoot,
      job,
      'Write content files',
      'succeeded',
      result.message,
    );

    if (body.runChecks) {
      job = await updateJobStep(projectRoot, job, 'Run checks', 'running');
      const output = await runCommand(projectRoot, 'corepack pnpm run check');
      job = await updateJobStep(
        projectRoot,
        job,
        'Run checks',
        'succeeded',
        output,
      );
    } else {
      job = await updateJobStep(projectRoot, job, 'Run checks', 'skipped');
    }

    if (shouldCommit) {
      job = await updateJobStep(projectRoot, job, 'Commit content', 'running');
      await runCommand(projectRoot, 'git add -- src/content public/images');
      const changed = await runCommand(
        projectRoot,
        'git diff --cached --name-only',
      );
      if (changed.trim()) {
        const output = await runCommand(
          projectRoot,
          `git commit -m "content: publish ${collection.id}/${id}"`,
        );
        job = await updateJobStep(
          projectRoot,
          job,
          'Commit content',
          'succeeded',
          output,
        );
      } else {
        job = await updateJobStep(
          projectRoot,
          job,
          'Commit content',
          'skipped',
          'No staged content changes.',
        );
      }
    } else {
      job = await updateJobStep(projectRoot, job, 'Commit content', 'skipped');
    }

    if (shouldPush) {
      job = await updateJobStep(projectRoot, job, 'Push branch', 'running');
      const output = await runCommand(projectRoot, 'git push');
      job = await updateJobStep(
        projectRoot,
        job,
        'Push branch',
        'succeeded',
        output,
      );
    } else {
      job = await updateJobStep(projectRoot, job, 'Push branch', 'skipped');
    }

    if (body.deploy) {
      job = await updateJobStep(projectRoot, job, 'Deploy site', 'running');
      const output = await runCommand(projectRoot, 'corepack pnpm run deploy');
      job = await updateJobStep(
        projectRoot,
        job,
        'Deploy site',
        'succeeded',
        output,
      );
    } else {
      job = await updateJobStep(projectRoot, job, 'Deploy site', 'skipped');
    }

    job = await writePublishJob(projectRoot, {
      ...job,
      status: 'succeeded',
    });
    const saved = await provider.readFile(path);
    return adminJson({
      job,
      entry: saved ? toDetail(collection, saved) : null,
    });
  } catch (error) {
    const response = writeConflictResponse(error);
    const failedJob = await writePublishJob(projectRoot, {
      ...job,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Publish failed.',
    });
    if (response) {
      return adminJson(
        {
          job: failedJob,
          error: 'This content changed since the draft was created.',
          code: 'revision_conflict',
        },
        { status: 409 },
      );
    }
    return adminJson(
      {
        job: failedJob,
        error: failedJob.error,
        code: 'publish_failed',
      },
      { status: 500 },
    );
  }
}

export async function handleContentPublishJob(
  projectRoot: string,
  id: string | undefined,
): Promise<Response> {
  if (!id) {
    return adminJson(
      { error: 'Publish job id is required.', code: 'missing_job_id' },
      { status: 400 },
    );
  }
  const job = await readPublishJob(projectRoot, id);
  if (!job) {
    return adminJson(
      { error: 'Publish job was not found.', code: 'not_found' },
      { status: 404 },
    );
  }
  return adminJson({ job });
}

export async function handleContentHistory(
  projectRoot: string,
  provider: ContentProvider,
  collectionId: string | undefined,
  id: string | undefined,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!id || !isValidSlug(id)) return badSlug();

  const existing = await findEntryFile(provider, collection, id);
  if (!existing) return adminJson({ revisions: [] });
  return adminJson({
    revisions: await readContentHistory(projectRoot, existing.path),
  });
}

export async function handleContentRestore(
  projectRoot: string,
  provider: ContentProvider,
  collectionId: string | undefined,
  id: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!id || !isValidSlug(id)) return badSlug();

  let body: { hash?: unknown };
  try {
    body = await readJsonBody<{ hash?: unknown }>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const existing = await findEntryFile(provider, collection, id);
  if (!existing) return missingEntry();
  const path = existing.path;
  const restored = parseContentDocument(
    await readRevisionContent(projectRoot, path, String(body.hash ?? '')),
    collection.format,
  );
  const draft = await writeDraft(
    projectRoot,
    draftFromDocument({
      collection,
      id,
      folder: entryFolderFromPath(existing.path, collection.sourceDir),
      fields: restored.fields,
      body: collection.body ? restored.body : '',
      revision: existing?.revision,
      isNew: false,
    }),
  );

  return adminJson({ draft });
}
