import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { adminJson, withAdminSecurityHeaders } from '../admin/response';
import { readJsonBody, requestBodyErrorResponse } from '../community/body';
import { bodyToBlocks, blocksToBody } from './blocks';
import { getContentCollection, getContentCollections } from './registry';
import {
  entryIdFromPath,
  isValidSlug,
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
import { ContentRevisionConflictError } from './types';
import type {
  ContentBlock,
  ContentCollectionDefinition,
  ContentDraft,
  ContentEntryDetail,
  ContentEntryListItem,
  ContentFieldDefinition,
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

  let body: { ids?: unknown };
  try {
    body = await readJsonBody<{ ids?: unknown }>(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }

  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : null;
  if (!ids || ids.length === 0 || ids.some((id) => !isValidSlug(id))) {
    return adminJson(
      {
        error: 'A non-empty array of valid entry ids is required.',
        code: 'invalid_ids',
      },
      { status: 400 },
    );
  }

  const entries = await readCollectionEntries(provider, collection);
  const existingIds = new Set(entries.map((entry) => entry.id));
  const uniqueIds = new Set(ids);
  if (
    uniqueIds.size !== ids.length ||
    ids.length !== entries.length ||
    ids.some((id) => !existingIds.has(id))
  ) {
    return adminJson(
      {
        error: 'Reorder ids must include every current entry exactly once.',
        code: 'invalid_reorder_ids',
      },
      { status: 400 },
    );
  }

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
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
    return adminJson({
      collection: publicCollection(collection),
      entries: await readCollectionEntries(provider, collection),
      drafts: await draftsForCollection(projectRoot, collection.id),
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

function titleFromFields(id: string, fields: Record<string, unknown>): string {
  return String(fields.title ?? id);
}

function draftFromDocument(args: {
  collection: ContentCollectionDefinition;
  id: string;
  fields: Record<string, unknown>;
  body: string;
  revision?: string;
  isNew: boolean;
}): ContentDraft {
  const now = new Date().toISOString();
  return {
    collection: args.collection.id,
    id: args.id,
    title: titleFromFields(args.id, args.fields),
    sourcePath: sourcePath(
      args.collection.sourceDir,
      args.id,
      args.collection.extension,
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
    fields: parsed.fields,
    body: collection.body ? parsed.body : '',
    revision: file.revision,
    isNew: false,
  });
}

interface DraftRequestBody {
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

  const path = sourcePath(collection.sourceDir, id, collection.extension);
  const existing = await provider.readFile(path);

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

function previewBlockHtml(block: ContentBlock): string {
  if (block.type === 'heading') {
    const level = Math.min(Math.max(block.level ?? 2, 1), 3);
    return `<h${level}>${escapeHtml(block.value)}</h${level}>`;
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
  return `<p>${escapeHtml(block.value)}</p>`;
}

function previewHtml(
  collection: ContentCollectionDefinition,
  document: ContentDraft,
): string {
  const title = titleFromFields(document.id, document.fields);
  const description = String(document.fields.description ?? '');
  const blocks =
    document.blocks.length > 0
      ? document.blocks
      : bodyToBlocks(document.body ?? '');
  const bodyHtml = collection.supportsBlocks
    ? blocks.map(previewBlockHtml).join('\n')
    : '';
  const bookCover =
    collection.id === 'books'
      ? `<div class="book-card"><img src="${escapeHtml(
          document.fields.coverImage,
        )}" alt="${escapeHtml(title)}" /><span>${escapeHtml(title)}</span></div>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} preview</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #0b0c0f; color: #e8e4ee; }
    body { margin: 0; padding: 40px 20px; }
    main { width: min(760px, 100%); margin: 0 auto; }
    header { border-bottom: 1px solid rgba(255,255,255,.14); margin-bottom: 24px; padding-bottom: 20px; }
    h1 { margin: 0 0 8px; font-size: clamp(2rem, 7vw, 4rem); line-height: 1; }
    p, li { line-height: 1.75; color: #c9c2d6; }
    img { max-width: 100%; border-radius: 8px; }
    pre, aside { border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 14px; background: rgba(255,255,255,.05); overflow: auto; }
    .meta { color: #a78bfa; font-family: ui-monospace, monospace; font-size: .75rem; text-transform: uppercase; letter-spacing: .12em; }
    .book-card { display: inline-grid; gap: 10px; text-align: center; }
    .book-card img { width: 150px; aspect-ratio: 95 / 125; object-fit: cover; }
  </style>
</head>
<body>
  <main>
    <p class="meta">${escapeHtml(collection.label)} draft preview</p>
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${description ? `<p>${escapeHtml(description)}</p>` : ''}
    </header>
    ${bookCover}
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
    const existing = await provider.readFile(
      sourcePath(collection.sourceDir, id, collection.extension),
    );

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
    const file = await provider.readFile(
      sourcePath(collection.sourceDir, id, collection.extension),
    );
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
    const bodyText = collection.body ? blocksToBody(draft.blocks) : '';
    job = await updateJobStep(projectRoot, job, 'Validate draft', 'succeeded');

    job = await updateJobStep(
      projectRoot,
      job,
      'Write content files',
      'running',
    );
    const path = sourcePath(collection.sourceDir, id, collection.extension);
    const existing = await provider.readFile(path);
    if (draft.isNew && existing) {
      throw new ContentRevisionConflictError();
    }
    const result = await provider.writeTextFile(
      path,
      serializeContentDocument(fields, bodyText, collection.format),
      `content: publish ${collection.id}/${id}`,
      existing ? (draft.sourceRevision ?? existing.revision) : undefined,
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
  collectionId: string | undefined,
  id: string | undefined,
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!id || !isValidSlug(id)) return badSlug();

  const path = sourcePath(collection.sourceDir, id, collection.extension);
  return adminJson({
    revisions: await readContentHistory(projectRoot, path),
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

  const path = sourcePath(collection.sourceDir, id, collection.extension);
  const restored = parseContentDocument(
    await readRevisionContent(projectRoot, path, String(body.hash ?? '')),
    collection.format,
  );
  const existing = await provider.readFile(path);
  const draft = await writeDraft(
    projectRoot,
    draftFromDocument({
      collection,
      id,
      fields: restored.fields,
      body: collection.body ? restored.body : '',
      revision: existing?.revision,
      isNew: false,
    }),
  );

  return adminJson({ draft });
}
