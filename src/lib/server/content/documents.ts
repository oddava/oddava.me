import {
  entryFolderFromPath,
  entryIdFromPath,
  normalizeFolderPath,
  sourcePath,
} from './paths';
import type { ContentCollectionMeta } from '../../contracts';
import { NOTES_COLLECTION } from './registry';
import { parseContentDocument, serializeContentDocument } from './serializers';
import type {
  ContentCollectionDefinition,
  ContentEntryDetail,
  ContentEntryListItem,
  ContentFolder,
  ContentSourceFile,
  ContentProvider,
} from './types';

export function publicCollection(
  collection: ContentCollectionDefinition,
): Omit<ContentCollectionMeta, 'count'> {
  return {
    id: collection.id,
    label: collection.label,
    singularLabel: collection.singularLabel,
    body: true as const,
  };
}

export function validateFields(
  collection: ContentCollectionDefinition,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return collection.schema.parse(fields);
}

function titleFromDocument(
  id: string,
  fields: Record<string, unknown>,
  body: string,
): string {
  const heading = body.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  if (heading) return heading;

  const legacyTitle =
    typeof fields.title === 'string' ? fields.title.trim() : '';
  return legacyTitle || id.replaceAll('-', ' ');
}

function noteHref(folder: string, id: string): string {
  if (!folder && id === 'index') return NOTES_COLLECTION.routePrefix;
  return `${NOTES_COLLECTION.routePrefix}/${[folder, id]
    .filter(Boolean)
    .join('/')}`;
}

function toListItem(
  collection: ContentCollectionDefinition,
  file: ContentSourceFile,
): ContentEntryListItem {
  const { fields, body } = parseContentDocument(file.content);
  const id = entryIdFromPath(file.path, collection.readExtensions);
  const folder = entryFolderFromPath(file.path, collection.sourceDir);
  const rawOrder = fields[collection.orderField];
  const order = typeof rawOrder === 'number' ? rawOrder : undefined;

  return {
    id,
    title: titleFromDocument(id, fields, body),
    folder,
    path: file.path,
    href: noteHref(folder, id),
    revision: file.revision,
    order,
  };
}

export function toDetail(
  collection: ContentCollectionDefinition,
  file: ContentSourceFile,
): ContentEntryDetail {
  const parsed = parseContentDocument(file.content);
  // Writes validate strictly (see the create/update handlers); reads must not.
  // If a stored note has invalid frontmatter, opening it in Studio is the only
  // way to repair it, so surface the raw fields rather than throwing a 500.
  const validated = collection.schema.safeParse(parsed.fields);
  return {
    ...toListItem(collection, file),
    fields: validated.success ? validated.data : parsed.fields,
    body: parsed.body,
  };
}

function sortEntries(entries: ContentEntryListItem[]): ContentEntryListItem[] {
  return entries.toSorted((left, right) => {
    const order =
      (left.order ?? Number.MAX_SAFE_INTEGER) -
      (right.order ?? Number.MAX_SAFE_INTEGER);
    return order || left.title.localeCompare(right.title);
  });
}

export async function readEntries(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
): Promise<ContentEntryListItem[]> {
  const files = await provider.listFiles(
    collection.sourceDir,
    collection.readExtensions,
  );
  return sortEntries(
    files
      .filter((file) => file.encoding === 'utf8')
      .map((file) => toListItem(collection, file)),
  );
}

export async function findEntry(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  id: string,
): Promise<ContentSourceFile | null> {
  // Entry ids are unique across the collection, so resolve id -> path from the
  // paths alone and read only the one record — rather than transferring every
  // note's full content (an MGET of the whole corpus) on each Studio open,
  // autosave, and delete just to pick one out.
  const path = (
    await provider.listFilePaths(
      collection.sourceDir,
      collection.readExtensions,
    )
  ).find(
    (candidate) => entryIdFromPath(candidate, collection.readExtensions) === id,
  );
  return path ? provider.readFile(path) : null;
}

export function folderName(folder: string): string {
  return folder.split('/').pop() ?? folder;
}

export function parentFolder(folder: string): string {
  const normalized = normalizeFolderPath(folder);
  return normalized.includes('/')
    ? normalized.slice(0, normalized.lastIndexOf('/'))
    : '';
}

export function folderRepositoryPath(
  collection: ContentCollectionDefinition,
  folder: string,
): string {
  return `${collection.sourceDir}/${normalizeFolderPath(folder)}`;
}

/** Where a folder's page is written. New pages always take `extension`. */
export function folderDocumentPath(
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

export interface FolderDocument {
  path: string;
  file: ContentSourceFile;
}

/**
 * A folder's page as it is actually stored, under whichever read extension it
 * was written with, or null.
 *
 * Looking only at the canonical `.md` path would miss a page the live store
 * still holds as `.mdx`, and callers treat "not found" as "create it" — which
 * would leave two files whose note ids collide. Every read, move, and delete of
 * a folder page therefore resolves through here rather than assuming an
 * extension.
 */
export async function findFolderDocument(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  folder: string,
): Promise<FolderDocument | null> {
  for (const extension of collection.readExtensions) {
    const path = sourcePath(
      collection.sourceDir,
      folderName(folder),
      extension,
      parentFolder(folder),
    );
    const file = await provider.readFile(path);
    if (file) return { path, file };
  }
  return null;
}

export async function folderExists(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  folder: string,
): Promise<boolean> {
  if (!folder) return true;
  return (await provider.listDirectories(collection.sourceDir)).includes(
    folderRepositoryPath(collection, folder),
  );
}

export async function ensureFolderDocument(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  folder: string,
): Promise<ContentSourceFile> {
  const existing = await findFolderDocument(provider, collection, folder);
  if (existing) return existing.file;

  const path = folderDocumentPath(collection, folder);

  const body = `# ${folderName(folder).replaceAll('-', ' ')}\n`;
  const fields = validateFields(collection, {
    updated: new Date().toISOString(),
  });
  await provider.writeTextFile(
    path,
    serializeContentDocument(fields, body),
    `content: create folder page ${collection.id}/${folder}`,
  );

  const created = await provider.readFile(path);
  if (!created) throw new Error('The folder page could not be created.');
  return created;
}

export async function readFolders(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
  entries?: ContentEntryListItem[],
): Promise<ContentFolder[]> {
  const collectionEntries =
    entries ?? (await readEntries(provider, collection));
  const folderIds = new Set(
    (await provider.listDirectories(collection.sourceDir))
      .map((directory) =>
        directory.startsWith(`${collection.sourceDir}/`)
          ? directory.slice(collection.sourceDir.length + 1)
          : '',
      )
      .filter(Boolean),
  );

  for (const entry of collectionEntries) {
    let current = entry.folder;
    while (current) {
      folderIds.add(current);
      current = parentFolder(current);
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
      const parentId = parentFolder(id) || null;
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

export function nextSiblingOrder(
  entries: ContentEntryListItem[],
  folder: string,
): number {
  const orders = entries
    .filter((entry) => entry.folder === folder)
    .map((entry) => entry.order)
    .filter((order): order is number => Number.isFinite(order));
  return orders.length > 0 ? Math.max(...orders) + 1 : 0;
}

export function contentWithOrder(
  collection: ContentCollectionDefinition,
  content: string,
  order: number,
): string {
  const parsed = parseContentDocument(content);
  parsed.fields[collection.orderField] = order;
  parsed.fields.updated = new Date().toISOString();
  return serializeContentDocument(
    validateFields(collection, parsed.fields),
    parsed.body,
  );
}

export function uniqueContentId(base: string, reserved: Set<string>): string {
  const normalizedBase =
    base
      .trim()
      .toLowerCase()
      .replace(/['"]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'copy';
  let candidate = normalizedBase;
  let suffix = 2;
  while (reserved.has(candidate)) {
    candidate = `${normalizedBase}-${suffix}`;
    suffix += 1;
  }
  reserved.add(candidate);
  return candidate;
}
