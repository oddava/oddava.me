import { readJsonBody, requestBodyErrorResponse } from '../core/body';
import { json } from '../core/http';
import {
  nextSiblingOrder,
  readEntries,
  toDetail,
  validateFields,
} from './documents';
import { methodNotAllowed, missingEntry, validationError } from './http';
import {
  entryIdFromPath,
  isValidFolderPath,
  isValidSlug,
  sourcePath,
} from './paths';
import { NOTES_COLLECTION } from './registry';
import { parseContentDocument, serializeContentDocument } from './serializers';
import { ContentConflictError, ContentNotFoundError } from './types';
import type { ContentProvider, ContentSourceFile } from './types';

/**
 * How large a notes API JSON body may be. Studio's content route allows 6 MB
 * because a request can carry an image; this API only accepts Markdown, and
 * a megabyte is already a very long note.
 */
export const MAX_NOTES_API_BYTES = 1024 * 1024;

export interface NoteSummary {
  path: string;
  title: string;
  updated: string;
  revision: string;
}

export interface NoteRecord extends NoteSummary {
  content: string;
}

interface WriteBody {
  path?: unknown;
  content?: unknown;
  revision?: unknown;
}

function relativeNotePath(storePath: string): string {
  const prefix = `${NOTES_COLLECTION.sourceDir}/`;
  return storePath.startsWith(prefix)
    ? storePath.slice(prefix.length)
    : storePath;
}

function updatedOf(
  file: Pick<ContentSourceFile, 'updatedAt'>,
  fields: Record<string, unknown>,
): string {
  const value = fields.updated;
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return file.updatedAt;
}

function summarize(file: ContentSourceFile): NoteSummary {
  const detail = toDetail(NOTES_COLLECTION, file);
  return {
    path: relativeNotePath(file.path),
    title: detail.title,
    updated: updatedOf(file, detail.fields),
    revision: file.revision,
  };
}

function recordFrom(file: ContentSourceFile): NoteRecord {
  return { ...summarize(file), content: file.content };
}

function noteJson(note: NoteRecord, status: number): Response {
  return json({ note }, { status });
}

function invalidPath(): Response {
  return json(
    {
      error:
        'Path must be a lowercase kebab-case note, like diary/hello.md. Folders and the file name use letters, numbers, and hyphens.',
      code: 'invalid_path',
    },
    { status: 400 },
  );
}

function invalidContent(): Response {
  return json(
    {
      error: 'content must be a string of Markdown.',
      code: 'invalid_content',
    },
    { status: 400 },
  );
}

function invalidRevision(): Response {
  return json(
    { error: 'revision must be a string.', code: 'invalid_revision' },
    { status: 400 },
  );
}

/**
 * The client-facing path, turned into the store key Studio already uses.
 *
 * Accepts `diary/hello`, `diary/hello.md`, or the full store path
 * `src/content/notes/diary/hello.md`. Anything that is not a relative note
 * path (another extension, `..`, uppercase, an empty segment) is rejected
 * before it can reach the store.
 */
export function resolveNotePath(input: string): {
  relative: string;
  storePath: string;
  slug: string;
  folder: string;
} | null {
  let value = input.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${NOTES_COLLECTION.sourceDir}/`;
  if (value.startsWith(prefix)) value = value.slice(prefix.length);
  if (!value || value.length > 512) return null;

  if (value.endsWith('.md')) {
    value = value.slice(0, -'.md'.length);
  } else if (/\.[a-z0-9]+$/i.test(value)) {
    return null;
  }

  // Reject empty segments before folder normalization. `foo//bar` would
  // otherwise collapse into `foo/bar` and write a different path than the
  // client asked for.
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0)) return null;
  const slug = segments.pop();
  if (!slug || !isValidSlug(slug)) return null;
  const folder = segments.join('/');
  if (!isValidFolderPath(folder)) return null;

  const storePath = sourcePath(
    NOTES_COLLECTION.sourceDir,
    slug,
    NOTES_COLLECTION.extension,
    folder,
  );
  return {
    relative: relativeNotePath(storePath),
    storePath,
    slug,
    folder,
  };
}

function conflict(
  code: 'path_exists' | 'revision_conflict' | 'slug_exists',
  file: ContentSourceFile,
): Response {
  const error =
    code === 'revision_conflict'
      ? 'This note changed since you last read it. Fetch it again and retry with the new revision.'
      : code === 'slug_exists'
        ? 'A note already uses that file name. Names are unique across the whole garden, not just inside one folder.'
        : 'A note already exists at that path.';
  return json({ error, code, note: summarize(file) }, { status: 409 });
}

async function readWriteBody(request: Request): Promise<WriteBody | Response> {
  try {
    return await readJsonBody<WriteBody>(request, MAX_NOTES_API_BYTES);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/**
 * The revision the client expects, when it sent one.
 *
 * Omitted, null, or blank means "I don't have a version": an update then
 * overwrites the current note. A present revision is compared with the
 * stored one so a sync client can tell that someone else (usually Studio)
 * saved in between.
 */
function expectedRevision(body: WriteBody): string | undefined | Response {
  if (body.revision === undefined || body.revision === null) return undefined;
  if (typeof body.revision !== 'string') return invalidRevision();
  const revision = body.revision.trim();
  return revision || undefined;
}

function markdownContent(body: WriteBody): string | Response {
  if (typeof body.content !== 'string') return invalidContent();
  return body.content;
}

/**
 * Frontmatter Studio and the garden already understand, plus a fresh
 * `updated`. Unknown keys are dropped because the note schema strips them;
 * the body is the source of truth for the writing itself.
 *
 * On update, an omitted `order` keeps the order already stored. Obsidian
 * does not know about that field, and dropping it would reshuffle the note
 * in Studio.
 */
function fieldsForWrite(
  content: string,
  existing: ContentSourceFile | null,
): Record<string, unknown> | Response {
  const parsed = parseContentDocument(content);
  const fields: Record<string, unknown> = { ...parsed.fields };
  if (
    !Object.prototype.hasOwnProperty.call(parsed.fields, 'order') &&
    existing
  ) {
    const current = toDetail(NOTES_COLLECTION, existing).order;
    if (current !== undefined) fields.order = current;
  }

  let validated: Record<string, unknown>;
  try {
    validated = validateFields(NOTES_COLLECTION, fields);
  } catch (error) {
    return validationError(error);
  }
  validated.updated = new Date().toISOString();
  return validated;
}

function serializeNote(
  fields: Record<string, unknown>,
  content: string,
): string {
  return serializeContentDocument(fields, parseContentDocument(content).body);
}

function storedFile(
  storePath: string,
  content: string,
  fields: Record<string, unknown>,
  revision: string,
): ContentSourceFile {
  return {
    path: storePath,
    content,
    encoding: 'utf8',
    byteLength: new TextEncoder().encode(content).byteLength,
    updatedAt: String(fields.updated),
    revision,
  };
}

export async function handleListNotes(
  provider: ContentProvider,
): Promise<Response> {
  const files = (
    await provider.listFiles(
      NOTES_COLLECTION.sourceDir,
      NOTES_COLLECTION.readExtensions,
    )
  ).filter((file) => file.encoding === 'utf8');
  const notes = files
    .map((file) => summarize(file))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  return json({ notes });
}

export async function handleReadNote(
  provider: ContentProvider,
  pathParam: string,
): Promise<Response> {
  const resolved = resolveNotePath(pathParam);
  if (!resolved) return invalidPath();
  const file = await provider.readFile(resolved.storePath);
  if (!file || file.encoding !== 'utf8') return missingEntry();
  return noteJson(recordFrom(file), 200);
}

export async function handleCreateNote(
  provider: ContentProvider,
  request: Request,
): Promise<Response> {
  const body = await readWriteBody(request);
  if (isResponse(body)) return body;
  if (typeof body.path !== 'string') return invalidPath();

  const resolved = resolveNotePath(body.path);
  if (!resolved) return invalidPath();
  const content = markdownContent(body);
  if (isResponse(content)) return content;
  // `revision` on create is ignored. Create means "this path must not exist";
  // a client that already has a revision should PUT.

  const fields = fieldsForWrite(content, null);
  if (isResponse(fields)) return fields;

  const entries = await readEntries(provider, NOTES_COLLECTION);
  const taken = entries.find((entry) => entry.id === resolved.slug);
  if (taken) {
    const other = await provider.readFile(taken.path);
    if (!other) return missingEntry();
    return conflict(
      taken.path === resolved.storePath ? 'path_exists' : 'slug_exists',
      other,
    );
  }

  if (fields.order === undefined) {
    fields.order = nextSiblingOrder(entries, resolved.folder);
  }
  const serialized = serializeNote(fields, content);

  try {
    const result = await provider.writeTextFile(
      resolved.storePath,
      serialized,
      `notes-api: create ${resolved.relative}`,
    );
    if (!result.revision) {
      throw new Error('The content store did not return a revision.');
    }
    return noteJson(
      recordFrom(
        storedFile(resolved.storePath, serialized, fields, result.revision),
      ),
      201,
    );
  } catch (error) {
    return writeError(provider, resolved.storePath, error);
  }
}

export async function handleUpdateNote(
  provider: ContentProvider,
  pathParam: string,
  request: Request,
): Promise<Response> {
  const resolved = resolveNotePath(pathParam);
  if (!resolved) return invalidPath();

  const body = await readWriteBody(request);
  if (isResponse(body)) return body;

  const existing = await provider.readFile(resolved.storePath);
  if (!existing || existing.encoding !== 'utf8') return missingEntry();

  const content = markdownContent(body);
  if (isResponse(content)) return content;
  const revision = expectedRevision(body);
  if (isResponse(revision)) return revision;
  if (revision !== undefined && revision !== existing.revision) {
    return conflict('revision_conflict', existing);
  }

  const fields = fieldsForWrite(content, existing);
  if (isResponse(fields)) return fields;
  const serialized = serializeNote(fields, content);

  try {
    // Always a compare-and-set against the revision just read. Callers that
    // omitted `revision` still get last-write-wins, but only for the snapshot
    // this request observed under the mutation lock.
    const result = await provider.writeTextFile(
      resolved.storePath,
      serialized,
      `notes-api: update ${resolved.relative}`,
      existing.revision,
    );
    if (!result.revision) {
      throw new Error('The content store did not return a revision.');
    }
    return noteJson(
      recordFrom(
        storedFile(resolved.storePath, serialized, fields, result.revision),
      ),
      200,
    );
  } catch (error) {
    return writeError(provider, resolved.storePath, error);
  }
}

async function writeError(
  provider: ContentProvider,
  storePath: string,
  error: unknown,
): Promise<Response> {
  if (error instanceof ContentNotFoundError) return missingEntry();
  if (!(error instanceof ContentConflictError)) throw error;

  const current = await provider.readFile(storePath);
  if (error.code === 'revision_conflict') {
    return current ? conflict('revision_conflict', current) : missingEntry();
  }
  if (error.code === 'path_exists' && current) {
    return conflict('path_exists', current);
  }

  // The file name may already live at a different path. Surface that note
  // when we can, so a sync client sees the collision instead of a bare 409.
  const slug = entryIdFromPath(storePath, NOTES_COLLECTION.readExtensions);
  const taken = (await readEntries(provider, NOTES_COLLECTION)).find(
    (entry) => entry.id === slug,
  );
  if (taken) {
    const other = await provider.readFile(taken.path);
    if (other) return conflict('slug_exists', other);
  }
  throw error;
}

export function pathFromParams(path: string | string[] | undefined): string {
  if (Array.isArray(path)) return path.join('/');
  return path ?? '';
}

export function notesMethodNotAllowed(allowed: readonly string[]): Response {
  return methodNotAllowed([...allowed]);
}
