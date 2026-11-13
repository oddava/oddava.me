import { adminJson } from '../admin/response';
import { readJsonBody, requestBodyErrorResponse } from '../core/body';
import type {
  NoteRestoreResponse,
  NoteRevisionResponse,
  NoteRevisionsResponse,
} from '../../history-contracts';
import { findEntry, toDetail, validateFields } from './documents';
import {
  contentConflictResponse,
  invalidSlug,
  methodNotAllowed,
  missingCollection,
  missingEntry,
  readRevision,
  revisionRequired,
  validationError,
} from './http';
import { isValidSlug } from './paths';
import { getContentCollection } from './registry';
import { createNoteRevisionStore, isRevisionId } from './revisions-store';
import type { NoteRevisionStore } from './revisions-store';
import { parseContentDocument, serializeContentDocument } from './serializers';
import { ContentConflictError } from './types';
import type { ContentProvider } from './types';

/**
 * Fields that describe where a note stands now rather than what it said:
 * a restore keeps the current value (or its absence) instead of the old one.
 *
 * - `order`: where a note sits among its siblings is the tree's business.
 * - `draft`: publishing is a deliberate act, not part of a note's text.
 *   Versions saved before drafts existed carry no key, so restoring one would
 *   silently publish a draft; restoring an old draft version would just as
 *   silently pull a live note.
 */
const CURRENT_STATE_FIELDS = ['order', 'draft'] as const;

function missingVersion(): Response {
  return adminJson(
    {
      error: 'That version is no longer kept.',
      code: 'version_not_found',
    },
    { status: 404 },
  );
}

function undoCopyUnavailable(): Response {
  return adminJson(
    {
      error:
        'This version was not restored: the current note could not be saved to history first, so the restore could not be undone. Nothing was changed.',
      code: 'restore_backup_failed',
    },
    { status: 409 },
  );
}

/**
 * A note's version history: list, preview, and restore. Restoring writes the
 * old Markdown as an ordinary save, after recording the note it replaces, so a
 * restore is one more step in the same history and can itself be undone.
 */
export async function handleContentRevisions(
  store: ContentProvider,
  collectionId: string | undefined,
  id: string | undefined,
  request: Request,
  revisions: NoteRevisionStore = createNoteRevisionStore(),
): Promise<Response> {
  const collection = getContentCollection(collectionId);
  if (!collection) return missingCollection();
  if (!id || !isValidSlug(id)) return invalidSlug();
  if (request.method !== 'GET' && request.method !== 'POST') {
    return methodNotAllowed(['GET', 'POST']);
  }

  const existing = await findEntry(store, collection, id);
  if (!existing) return missingEntry();

  if (request.method === 'GET') {
    const versionId = new URL(request.url).searchParams.get('version');
    if (versionId === null) {
      return adminJson({
        versions: await revisions.list(id, existing.path),
      } satisfies NoteRevisionsResponse);
    }
    const version = isRevisionId(versionId)
      ? await revisions.read(id, existing.path, versionId)
      : null;
    if (!version) return missingVersion();
    const { content, ...meta } = version;
    return adminJson({
      version: { ...meta, ...parseContentDocument(content) },
    } satisfies NoteRevisionResponse);
  }

  let body: { versionId?: unknown; revision?: unknown };
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return requestBodyErrorResponse(error);
  }
  const revision = readRevision(body);
  if (!revision) return revisionRequired();
  if (existing.revision !== revision) {
    return contentConflictResponse(
      new ContentConflictError('revision_conflict'),
    );
  }

  const versionId = typeof body.versionId === 'string' ? body.versionId : '';
  const version = isRevisionId(versionId)
    ? await revisions.read(id, existing.path, versionId)
    : null;
  if (!version) return missingVersion();

  // Unlike the best-effort record a plain save leaves, this one is the promise
  // that a restore can be undone: if it cannot be made, nothing is overwritten.
  // A thrown error and a declined copy (a note over the history size cap, or
  // one that changed under us) are the same broken promise.
  const outcome = await revisions.snapshot({
    id,
    filePath: existing.path,
    expectedRevision: existing.revision,
    force: true,
    reason: 'pre-restore',
  });
  if (outcome !== 'recorded' && outcome !== 'unchanged') {
    return undoCopyUnavailable();
  }

  const restored = parseContentDocument(version.content);
  const current = parseContentDocument(existing.content).fields;
  const fields: Record<string, unknown> = { ...restored.fields };
  for (const key of CURRENT_STATE_FIELDS) {
    if (Object.hasOwn(current, key)) fields[key] = current[key];
    else delete fields[key];
  }
  fields.updated = new Date().toISOString();

  let validated: Record<string, unknown>;
  try {
    validated = validateFields(collection, fields);
  } catch (error) {
    return validationError(error);
  }
  const content = serializeContentDocument(validated, restored.body);
  try {
    const result = await store.writeTextFile(
      existing.path,
      content,
      `content: restore ${collection.id}/${id}`,
      existing.revision,
    );
    return adminJson({
      // The fields actually written, so Studio can resync its draft pill even
      // when the store returns no revision to build `entry` from.
      fields: validated,
      entry: result.revision
        ? toDetail(collection, {
            path: existing.path,
            content,
            revision: result.revision,
          })
        : null,
      result,
    } satisfies NoteRestoreResponse);
  } catch (error) {
    return contentConflictResponse(error);
  }
}
