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
  const id = entryIdFromPath(file.path, collection.extension);
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
  return {
    ...toListItem(collection, file),
    fields: validateFields(collection, parsed.fields),
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
    collection.extension,
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
  const path = folderDocumentPath(collection, folder);
  const existing = await provider.readFile(path);
  if (existing) return existing;

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
