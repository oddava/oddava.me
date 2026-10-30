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
  followNoteRedirect,
  NoteArchiveError,
  tombstoneFile,
} from './note-archive';
import type { NotesStore, StoredTombstone } from './note-archive';
import {
  entryIdFromPath,
  isValidFolderPath,
  isValidSlug,
  sourcePath,
} from './paths';
import { NOTES_COLLECTION } from './registry';
import { parseContentDocument, serializeContentDocument } from './serializers';
import { ContentConflictError, ContentNotFoundError } from './types';
import type { ContentSourceFile } from './types';

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

export interface DeletedNoteSummary extends NoteSummary {
  deletedAt: string;
}

interface WriteBody {
  path?: unknown;
  from?: unknown;
  to?: unknown;
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
  /** Garden path without `.md`, such as `diary/hello`. */
  publicPath: string;
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
    publicPath: folder ? `${folder}/${slug}` : slug,
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

export async function handleListNotes(provider: NotesStore): Promise<Response> {
  const files = (
    await provider.listFiles(
      NOTES_COLLECTION.sourceDir,
      NOTES_COLLECTION.readExtensions,
    )
  ).filter((file) => file.encoding === 'utf8');
  const notes = files
    .map((file) => summarize(file))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const deleted = (await provider.listTombstones())
    .map(({ publicPath, tombstone }) => deletedSummary(publicPath, tombstone))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  return json({ notes, deleted });
}

export async function handleReadNote(
  provider: NotesStore,
  pathParam: string,
): Promise<Response> {
  const resolved = resolveNotePath(pathParam);
  if (!resolved) return invalidPath();
  const file = await provider.readFile(resolved.storePath);
  if (file && file.encoding === 'utf8') return noteJson(recordFrom(file), 200);
  return (
    (await retiredResponse(provider, resolved.publicPath)) ?? missingEntry()
  );
}

export async function handleCreateNote(
  provider: NotesStore,
  request: Request,
): Promise<Response> {
  const body = await readWriteBody(request);
  if (isResponse(body)) return body;
  if (typeof body.path !== 'string') return invalidPath();

  const resolved = resolveNotePath(body.path);
  if (!resolved) return invalidPath();
  const retired = await retiredResponse(provider, resolved.publicPath, {
    write: true,
  });
  if (retired) return retired;
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
  provider: NotesStore,
  pathParam: string,
  request: Request,
): Promise<Response> {
  const resolved = resolveNotePath(pathParam);
  if (!resolved) return invalidPath();

  const body = await readWriteBody(request);
  if (isResponse(body)) return body;

  const existing = await provider.readFile(resolved.storePath);
  if (!existing || existing.encoding !== 'utf8') {
    return (
      (await retiredResponse(provider, resolved.publicPath)) ?? missingEntry()
    );
  }

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
  provider: NotesStore,
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

function isGardenRoot(resolved: { slug: string; folder: string }): boolean {
  return resolved.slug === 'index' && resolved.folder === '';
}

function rootNoteResponse(): Response {
  return json(
    {
      error: 'The Notes root cannot be moved, renamed, or deleted.',
      code: 'root_entry',
    },
    { status: 400 },
  );
}

function deletedSummary(
  publicPath: string,
  tombstone: StoredTombstone,
): DeletedNoteSummary {
  const resolved = resolveNotePath(publicPath);
  const file = tombstoneFile(
    resolved?.storePath ?? `${NOTES_COLLECTION.sourceDir}/${publicPath}.md`,
    tombstone,
  );
  return {
    ...summarize(file),
    path: resolved?.relative ?? `${publicPath}.md`,
    deletedAt: tombstone.deletedAt,
  };
}

function goneResponse(
  publicPath: string,
  tombstone: StoredTombstone,
): Response {
  const note = deletedSummary(publicPath, tombstone);
  return json(
    {
      error: 'This note was removed.',
      code: 'gone',
      note: { ...note, content: tombstone.content },
    },
    { status: 410 },
  );
}

function deletedConflict(
  publicPath: string,
  tombstone: StoredTombstone,
): Response {
  return json(
    {
      error:
        'A deleted note still holds that path. Restore it, or choose a different path.',
      code: 'deleted',
      note: deletedSummary(publicPath, tombstone),
    },
    { status: 409 },
  );
}

function movedResponse(file: ContentSourceFile): Response {
  return json(
    {
      error: 'That note now lives at a different path.',
      code: 'moved',
      location: relativeNotePath(file.path),
      note: summarize(file),
    },
    { status: 409 },
  );
}

/**
 * A path with no live file. Writes onto a tombstone conflict (`deleted`);
 * reads, updates, and deletes of one are `gone`. A redirect chain that ends
 * at a live note is `moved`. A chain that ends in the trash is `gone`.
 */
async function retiredResponse(
  provider: NotesStore,
  publicPath: string,
  options?: { write?: boolean },
): Promise<Response | null> {
  const tombstone = await provider.readTombstone(publicPath);
  if (tombstone) {
    return options?.write
      ? deletedConflict(publicPath, tombstone)
      : goneResponse(publicPath, tombstone);
  }

  const followed = followNoteRedirect(
    publicPath,
    await provider.listRedirects(),
  );
  if (!followed.hopped || followed.cycle) return null;

  const destinationTombstone = await provider.readTombstone(followed.path);
  if (destinationTombstone) {
    return goneResponse(followed.path, destinationTombstone);
  }

  const destination = resolveNotePath(followed.path);
  if (!destination) return null;
  const live = await provider.readFile(destination.storePath);
  if (!live || live.encoding !== 'utf8') return null;
  return movedResponse(live);
}

async function folderPageHasNotes(
  provider: NotesStore,
  storePath: string,
): Promise<boolean> {
  const prefix = `${storePath.slice(0, -'.md'.length)}/`;
  const files = await provider.listFiles(
    NOTES_COLLECTION.sourceDir,
    NOTES_COLLECTION.readExtensions,
  );
  return files.some((file) => file.path.startsWith(prefix));
}

async function readOptionalObject(
  request: Request,
): Promise<WriteBody | Response> {
  const text = await request.clone().text();
  if (!text.trim()) return {};
  return readWriteBody(request);
}

function samePathResponse(): Response {
  return json(
    { error: 'Destination is the same path.', code: 'invalid_request' },
    { status: 400 },
  );
}

function folderNotEmptyResponse(): Response {
  return json(
    {
      error: 'Move the notes out of this folder before deleting it.',
      code: 'folder_not_empty',
    },
    { status: 409 },
  );
}

export async function handleMoveNote(
  provider: NotesStore,
  request: Request,
): Promise<Response> {
  const body = await readWriteBody(request);
  if (isResponse(body)) return body;
  if (typeof body.from !== 'string' || typeof body.to !== 'string') {
    return invalidPath();
  }

  const source = resolveNotePath(body.from);
  const target = resolveNotePath(body.to);
  if (!source || !target) return invalidPath();
  if (isGardenRoot(source) || isGardenRoot(target)) return rootNoteResponse();
  if (source.storePath === target.storePath) return samePathResponse();

  const existing = await provider.readFile(source.storePath);
  if (!existing || existing.encoding !== 'utf8') {
    return (
      (await retiredResponse(provider, source.publicPath)) ?? missingEntry()
    );
  }

  const revision = expectedRevision(body);
  if (isResponse(revision)) return revision;
  if (revision !== undefined && revision !== existing.revision) {
    return conflict('revision_conflict', existing);
  }

  const targetTombstone = await provider.readTombstone(target.publicPath);
  if (targetTombstone) {
    return deletedConflict(target.publicPath, targetTombstone);
  }
  const targetFile = await provider.readFile(target.storePath);
  if (targetFile && targetFile.encoding === 'utf8') {
    return conflict('path_exists', targetFile);
  }

  const taken = (await readEntries(provider, NOTES_COLLECTION)).find(
    (entry) => entry.id === target.slug && entry.path !== source.storePath,
  );
  if (taken) {
    const other = await provider.readFile(taken.path);
    if (!other) return missingEntry();
    return conflict(
      taken.path === target.storePath ? 'path_exists' : 'slug_exists',
      other,
    );
  }

  try {
    const result = await provider.moveArchivedNote({
      fromStorePath: source.storePath,
      toStorePath: target.storePath,
      fromPublic: source.publicPath,
      toPublic: target.publicPath,
      revision: existing.revision,
      message: `notes-api: move ${source.relative} to ${target.relative}`,
    });
    if (!result.revision) {
      throw new Error('The content store did not return a revision.');
    }
    const fields = parseContentDocument(existing.content).fields;
    const updatedAt =
      typeof fields.updated === 'string' && fields.updated.trim()
        ? fields.updated
        : existing.updatedAt;
    return json(
      {
        from: source.relative,
        note: recordFrom({
          path: target.storePath,
          content: existing.content,
          encoding: 'utf8',
          byteLength: existing.byteLength,
          updatedAt,
          revision: result.revision,
        }),
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof NoteArchiveError && error.code === 'deleted') {
      const tombstone = await provider.readTombstone(target.publicPath);
      if (tombstone) return deletedConflict(target.publicPath, tombstone);
    }
    if (error instanceof NoteArchiveError && error.code === 'gone') {
      return (
        (await retiredResponse(provider, source.publicPath)) ?? missingEntry()
      );
    }
    return writeError(provider, source.storePath, error);
  }
}

export async function handleDeleteNote(
  provider: NotesStore,
  pathParam: string,
  request: Request,
): Promise<Response> {
  const resolved = resolveNotePath(pathParam);
  if (!resolved) return invalidPath();
  if (isGardenRoot(resolved)) return rootNoteResponse();

  const body = await readOptionalObject(request);
  if (isResponse(body)) return body;

  const existing = await provider.readFile(resolved.storePath);
  if (!existing || existing.encoding !== 'utf8') {
    return (
      (await retiredResponse(provider, resolved.publicPath)) ?? missingEntry()
    );
  }

  const revision = expectedRevision(body);
  if (isResponse(revision)) return revision;
  if (revision !== undefined && revision !== existing.revision) {
    return conflict('revision_conflict', existing);
  }
  if (await folderPageHasNotes(provider, resolved.storePath)) {
    return folderNotEmptyResponse();
  }

  try {
    const tombstone = await provider.softDeleteNote({
      storePath: resolved.storePath,
      publicPath: resolved.publicPath,
      revision: existing.revision,
      message: `notes-api: delete ${resolved.relative}`,
    });
    return json(
      { note: deletedSummary(resolved.publicPath, tombstone) },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof NoteArchiveError && error.code === 'gone') {
      return (
        (await retiredResponse(provider, resolved.publicPath)) ?? missingEntry()
      );
    }
    return writeError(provider, resolved.storePath, error);
  }
}

export async function handleRestoreNote(
  provider: NotesStore,
  request: Request,
): Promise<Response> {
  const body = await readOptionalObject(request);
  if (isResponse(body)) return body;
  if (typeof body.path !== 'string') return invalidPath();

  const resolved = resolveNotePath(body.path);
  if (!resolved) return invalidPath();
  if (isGardenRoot(resolved)) return rootNoteResponse();

  const live = await provider.readFile(resolved.storePath);
  if (live && live.encoding === 'utf8') return conflict('path_exists', live);

  const tombstone = await provider.readTombstone(resolved.publicPath);
  if (!tombstone) return missingEntry();

  const revision = expectedRevision(body);
  if (isResponse(revision)) return revision;
  if (revision !== undefined && revision !== tombstone.rev) {
    return conflict(
      'revision_conflict',
      tombstoneFile(resolved.storePath, tombstone),
    );
  }

  const taken = (await readEntries(provider, NOTES_COLLECTION)).find(
    (entry) => entry.id === resolved.slug,
  );
  if (taken) {
    const other = await provider.readFile(taken.path);
    if (!other) return missingEntry();
    return conflict('slug_exists', other);
  }

  try {
    const result = await provider.restoreArchivedNote({
      storePath: resolved.storePath,
      publicPath: resolved.publicPath,
      revision,
      record: JSON.stringify({
        content: tombstone.content,
        enc: 'utf8',
        rev: tombstone.rev,
        createdAt: tombstone.createdAt,
        updatedAt: tombstone.updatedAt,
      }),
      message: `notes-api: restore ${resolved.relative}`,
    });
    if (!result.revision) {
      throw new Error('The content store did not return a revision.');
    }
    const fields = parseContentDocument(tombstone.content).fields;
    return noteJson(
      recordFrom(
        storedFile(
          resolved.storePath,
          tombstone.content,
          fields,
          result.revision,
        ),
      ),
      200,
    );
  } catch (error) {
    if (
      error instanceof ContentConflictError &&
      error.code === 'revision_conflict'
    ) {
      const current = await provider.readTombstone(resolved.publicPath);
      if (current) {
        return conflict(
          'revision_conflict',
          tombstoneFile(resolved.storePath, current),
        );
      }
    }
    return writeError(provider, resolved.storePath, error);
  }
}

export function pathFromParams(path: string | string[] | undefined): string {
  if (Array.isArray(path)) return path.join('/');
  return path ?? '';
}

export function notesMethodNotAllowed(allowed: readonly string[]): Response {
  return methodNotAllowed([...allowed]);
}
