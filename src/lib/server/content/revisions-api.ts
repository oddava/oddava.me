import { adminJson } from '../admin/response';
import { readJsonBody, requestBodyErrorResponse } from '../core/body';
import type {
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

function missingVersion(): Response {
  return adminJson(
    {
      error: 'That version is no longer kept.',
      code: 'version_not_found',
    },
    { status: 404 },
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
        versions: await revisions.list(id),
      } satisfies NoteRevisionsResponse);
    }
    const version = isRevisionId(versionId)
      ? await revisions.read(id, versionId)
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
    ? await revisions.read(id, versionId)
    : null;
  if (!version) return missingVersion();

  // Unlike the best-effort record a plain save leaves, this one is the promise
  // that a restore can be undone: if it cannot be made, nothing is overwritten.
  await revisions.snapshot({
    id,
    filePath: existing.path,
    expectedRevision: existing.revision,
    force: true,
    reason: 'pre-restore',
  });

  const restored = parseContentDocument(version.content);
  // Where a note sits among its siblings is the tree's business, not part of
  // what its text was.
  const { order } = parseContentDocument(existing.content).fields;
  const fields: Record<string, unknown> = { ...restored.fields, order };
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
      entry: result.revision
        ? toDetail(collection, {
            path: existing.path,
            content,
            revision: result.revision,
          })
        : null,
      result,
    });
  } catch (error) {
    return contentConflictResponse(error);
  }
}
