import { adminJson } from '../admin/response';
import { isStorageUnavailableError } from '../core';
import { ContentMutationBusyError } from './redis-store';
import {
  ContentConflictError,
  ContentFolderNotEmptyError,
  ContentNotFoundError,
} from './types';

export function methodNotAllowed(allowed: string[]): Response {
  return adminJson(
    { error: 'Method not allowed.', code: 'method_not_allowed' },
    { status: 405, headers: { Allow: allowed.join(', ') } },
  );
}

export function missingCollection(): Response {
  return adminJson(
    { error: 'Unknown content collection.', code: 'unknown_collection' },
    { status: 404 },
  );
}

export function missingEntry(): Response {
  return adminJson(
    { error: 'Content entry was not found.', code: 'not_found' },
    { status: 404 },
  );
}

export function invalidSlug(): Response {
  return adminJson(
    { error: 'Slug must use lowercase kebab-case.', code: 'invalid_slug' },
    { status: 400 },
  );
}

export function invalidFolder(): Response {
  return adminJson(
    {
      error: 'Folder names must use lowercase letters, numbers, and hyphens.',
      code: 'invalid_folder',
    },
    { status: 400 },
  );
}

export function folderNotFound(
  message = 'That folder no longer exists.',
): Response {
  return adminJson(
    { error: message, code: 'folder_not_found' },
    { status: 404 },
  );
}

export function folderAlreadyExists(): Response {
  return adminJson(
    { error: 'That folder already exists.', code: 'folder_exists' },
    { status: 409 },
  );
}

export function slugExists(message: string): Response {
  return adminJson({ error: message, code: 'slug_exists' }, { status: 409 });
}

export function invalidFolderMove(message: string): Response {
  return adminJson(
    { error: message, code: 'invalid_folder_move' },
    { status: 400 },
  );
}

/** The expected revision a compare-and-set request carries, or '' if absent. */
export function readRevision(body: { revision?: unknown }): string {
  return typeof body.revision === 'string' ? body.revision.trim() : '';
}

export function revisionRequired(): Response {
  return adminJson(
    {
      error: 'The current content revision is required for this operation.',
      code: 'revision_required',
    },
    { status: 400 },
  );
}

export function validationError(error: unknown): Response {
  const issues =
    error &&
    typeof error === 'object' &&
    'issues' in error &&
    Array.isArray(error.issues)
      ? error.issues
      : [];

  return adminJson(
    { error: 'Content validation failed.', code: 'validation_failed', issues },
    { status: 400 },
  );
}

export function contentConflictResponse(error: unknown): Response {
  const code =
    error instanceof ContentConflictError ||
    error instanceof ContentNotFoundError
      ? error.code
      : error && typeof error === 'object' && 'code' in error
        ? error.code
        : null;

  // Gone is not the same as changed. Answering 409 "refresh and try again" for
  // content that no longer exists sends the author round a loop that cannot
  // terminate.
  if (code === 'not_found') return missingEntry();
  if (code !== 'revision_conflict' && code !== 'path_exists') throw error;

  return adminJson(
    {
      error:
        error instanceof Error
          ? error.message
          : 'The content write conflicted.',
      code,
    },
    { status: 409 },
  );
}

export function contentFolderErrorResponse(error: unknown): Response {
  const isFolderNotEmpty =
    error instanceof ContentFolderNotEmptyError ||
    (error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'folder_not_empty');
  if (!isFolderNotEmpty) return contentConflictResponse(error);

  return adminJson(
    {
      error: 'Move the notes out of this folder before deleting it.',
      code: 'folder_not_empty',
    },
    { status: 409 },
  );
}

const STORE_NOT_CONFIGURED_MESSAGE =
  'Studio storage is not configured. Configure the production Redis credentials and try again.';
const STORE_UNREACHABLE_MESSAGE =
  'Studio could not reach its content store. Try again shortly.';

export function contentStoreUnavailable(
  message = STORE_NOT_CONFIGURED_MESSAGE,
): Response {
  return adminJson(
    { error: message, code: 'content_store_unavailable' },
    { status: 503 },
  );
}

/**
 * Maps the store-level failures every Studio route shares — a held mutation
 * lock, an unreachable store — onto HTTP. Null for anything else, which the
 * caller still owns.
 */
export function contentStoreErrorResponse(error: unknown): Response | null {
  if (error instanceof ContentMutationBusyError) {
    return adminJson(
      { error: error.message, code: error.code },
      { status: 503, headers: { 'Retry-After': '1' } },
    );
  }
  if (isStorageUnavailableError(error)) {
    return contentStoreUnavailable(STORE_UNREACHABLE_MESSAGE);
  }
  return null;
}
