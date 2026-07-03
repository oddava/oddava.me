import { adminJson } from '../admin';
import { readJsonBody, requestBodyErrorResponse } from '../community';
import { getContentCollection, getContentCollections } from './registry';
import {
  entryIdFromPath,
  isValidSlug,
  sanitizeFilename,
  slugify,
  sourcePath,
} from './paths';
import { parseContentDocument, serializeContentDocument } from './serializers';
import type {
  ContentCollectionDefinition,
  ContentEntryDetail,
  ContentEntryListItem,
  ContentFieldDefinition,
  ContentProvider,
  ContentSourceFile,
} from './types';

const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/gif',
]);

interface SaveEntryBody {
  slug?: string;
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
    fields: collection.fields,
    media: {
      publicPath: collection.mediaPublicPath,
      groupByEntry: collection.groupMediaByEntry,
    },
  };
}

function notReorderable(): Response {
  return adminJson(
    { error: 'This collection does not support reordering.', code: 'not_reorderable' },
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
  if (!collection.reorderable || !collection.orderField) return notReorderable();

  let body: { ids?: unknown };
  try {
    body = await readJsonBody<{ ids?: unknown }>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const ids = Array.isArray(body.ids) ? body.ids : null;
  if (!ids || ids.length === 0 || ids.some((id) => !isValidSlug(String(id)))) {
    return adminJson(
      { error: 'A non-empty array of valid entry ids is required.', code: 'invalid_ids' },
      { status: 400 },
    );
  }

  const orderField = collection.orderField;
  const results: { id: string; ok: boolean }[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const id = String(ids[index]!);
    const path = sourcePath(collection.sourceDir, id, collection.extension);
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
    await provider.writeTextFile(
      path,
      next,
      `content: reorder ${collection.id}/${id} -> ${index}`,
      existing.revision,
    );
    results.push({ id, ok: true });
  }

  return adminJson({ reordered: results });
}

function fieldDefault(field: ContentFieldDefinition): unknown {
  if (field.type === 'boolean') return false;
  if (field.type === 'string-list') return [];
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
    title: String(parsed.fields.title ?? id),
    path: file.path,
    revision: file.revision,
    meta: {
      date: parsed.fields.date,
      draft: parsed.fields.draft,
      featured: parsed.fields.featured,
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

function sortEntries(
  collection: ContentCollectionDefinition,
  entries: ContentEntryListItem[],
): ContentEntryListItem[] {
  if (collection.id === 'blog') {
    return entries.toSorted((left, right) =>
      String(right.meta.date ?? '').localeCompare(String(left.meta.date ?? '')),
    );
  }
  if (collection.id === 'books') {
    return entries.toSorted((left, right) => {
      const order =
        Number(left.meta.order ?? Number.MAX_SAFE_INTEGER) -
        Number(right.meta.order ?? Number.MAX_SAFE_INTEGER);
      return order || left.title.localeCompare(right.title);
    });
  }
  return entries.toSorted((left, right) =>
    left.title.localeCompare(right.title),
  );
}

async function readCollectionEntries(
  provider: ContentProvider,
  collection: ContentCollectionDefinition,
): Promise<ContentEntryListItem[]> {
  const files = await provider.listFiles(
    collection.sourceDir,
    collection.extension,
  );
  return sortEntries(
    collection,
    files.map((file) => toListItem(collection, file)),
  );
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

export async function handleContentCollections(
  provider: ContentProvider,
): Promise<Response> {
  const collections = await Promise.all(
    getContentCollections().map(async (collection) => ({
      ...publicCollection(collection),
      count: (await readCollectionEntries(provider, collection)).length,
    })),
  );

  return adminJson({ collections, provider: provider.kind });
}

export async function handleContentCollection(
  provider: ContentProvider,
  collectionId: string | undefined,
  request: Request,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();

  if (request.method === 'GET') {
    return adminJson({
      collection: publicCollection(collection),
      entries: await readCollectionEntries(provider, collection),
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

  const path = sourcePath(collection.sourceDir, slug, collection.extension);
  if (await provider.readFile(path)) {
    return adminJson(
      { error: 'A content entry already uses that slug.', code: 'slug_exists' },
      { status: 409 },
    );
  }

  let validatedFields: Record<string, unknown>;
  try {
    validatedFields = validateFields(collection, fields);
  } catch (error) {
    return validationError(error);
  }

  const message = `content: create ${collection.id}/${slug}`;
  const result = await provider.writeTextFile(
    path,
    serializeContentDocument(
      validatedFields,
      collection.body ? String(body.body ?? '') : '',
      collection.format,
    ),
    message,
  );
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

  const path = sourcePath(collection.sourceDir, id, collection.extension);
  const existing = await provider.readFile(path);
  if (!existing) return missingEntry();

  if (request.method === 'GET') {
    return adminJson({
      collection: publicCollection(collection),
      entry: toDetail(collection, existing),
      provider: provider.kind,
    });
  }

  if (request.method === 'DELETE') {
    const result = await provider.deleteFile(
      path,
      `content: delete ${collection.id}/${id}`,
      existing.revision,
    );
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

  const result = await provider.writeTextFile(
    path,
    serializeContentDocument(
      validatedFields,
      collection.body ? String(body.body ?? '') : '',
      collection.format,
    ),
    `content: update ${collection.id}/${id}`,
    body.revision ?? existing.revision,
  );
  const saved = await provider.readFile(path);

  return adminJson({
    entry: saved ? toDetail(collection, saved) : null,
    result,
  });
}

export async function handleContentMedia(
  provider: ContentProvider,
  request: Request,
): Promise<Response> {
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
