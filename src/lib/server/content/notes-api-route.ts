import type { APIContext } from 'astro';
import { boundedRequest, RequestBodyError } from '../core/body';
import { delay } from '../core/delay';
import { json } from '../core/http';
import { enforceRedisRateLimit } from '../core/rate-limit';
import { contentStoreErrorResponse, contentStoreUnavailable } from './http';
import {
  handleCreateNote,
  handleListNotes,
  handleReadNote,
  handleUpdateNote,
  MAX_NOTES_API_BYTES,
  notesMethodNotAllowed,
  pathFromParams,
} from './notes-api';
import {
  isNotesApiEnabled,
  notesApiDisabledResponse,
  notesApiUnauthorized,
} from './notes-api-auth';
import {
  ContentMutationBusyError,
  createRedisContentProvider,
  hasContentStore,
  readStableContentVersion,
  withRedisContentMutationLock,
} from './redis-store';
import type { ContentProvider } from './types';

// Same snapshot barrier as the Studio content route: a reader retries until
// the content version is unchanged across the read, so a folder move in
// another isolate cannot be observed half-finished. Reads must stay free of
// writes — the loop may run them more than once.
const STABLE_READ_ATTEMPTS = 30;
const STABLE_READ_RETRY_MS = 100;

// One owner syncing a garden, not a public form. A full pull is one list
// plus a fetch per changed note; 120/minute covers that and still slows a
// token-guessing loop.
const NOTES_API_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

const COLLECTION_METHODS = ['GET', 'POST'];
const ENTRY_METHODS = ['GET', 'PUT'];

async function rejectIfNotAllowed(request: Request): Promise<Response | null> {
  // Checked before the bearer compare so a copied `.env.example` (or a
  // forgotten `wrangler secret put`) cannot be mistaken for a bad token.
  if (!isNotesApiEnabled()) return notesApiDisabledResponse();

  const rateLimitError = await enforceRedisRateLimit(
    request,
    'notes-api',
    NOTES_API_RATE_LIMIT.limit,
    NOTES_API_RATE_LIMIT.windowMs,
  );
  if (rateLimitError) return rateLimitError;

  return notesApiUnauthorized(request);
}

async function withStore(
  request: Request,
  mutation: boolean,
  run: (provider: ContentProvider) => Promise<Response>,
): Promise<Response> {
  if (!hasContentStore()) {
    return contentStoreUnavailable(
      'The notes store is not configured. Set the Redis credentials and try again.',
    );
  }

  const provider = createRedisContentProvider();
  if (!mutation) {
    for (let attempt = 0; ; attempt += 1) {
      const version = await readStableContentVersion();
      if (version !== null) {
        const candidate = await run(provider);
        if ((await readStableContentVersion()) === version) return candidate;
      }
      if (attempt >= STABLE_READ_ATTEMPTS - 1) {
        throw new ContentMutationBusyError();
      }
      await delay(STABLE_READ_RETRY_MS, request.signal);
    }
  }

  return withRedisContentMutationLock(() => run(provider), {
    signal: request.signal,
  });
}

async function dispatch(
  request: Request,
  allowed: readonly string[],
  mutation: boolean,
  run: (provider: ContentProvider, request: Request) => Promise<Response>,
): Promise<Response> {
  const denied = await rejectIfNotAllowed(request);
  if (denied) return denied;
  if (!allowed.includes(request.method)) return notesMethodNotAllowed(allowed);

  let bounded = request;
  try {
    bounded = await boundedRequest(request, MAX_NOTES_API_BYTES);
    return await withStore(bounded, mutation, (provider) =>
      run(provider, bounded),
    );
  } catch (error) {
    if (
      error instanceof RequestBodyError &&
      error.code === 'payload_too_large'
    ) {
      return json(
        {
          error: 'Notes API requests are limited to 1 MB.',
          code: 'payload_too_large',
        },
        { status: 413 },
      );
    }
    const storeError = contentStoreErrorResponse(error);
    if (storeError) return storeError;
    const requestId = crypto.randomUUID();
    console.error(`[notes-api] request failed (${requestId})`, error);
    return json(
      {
        error: 'The notes API could not complete the request.',
        code: 'notes_api_unavailable',
        requestId,
      },
      { status: 500 },
    );
  }
}

/** `GET /api/notes` lists notes. `POST /api/notes` creates one. */
export function notesCollectionRoute(context: APIContext): Promise<Response> {
  const mutation = context.request.method === 'POST';
  return dispatch(
    context.request,
    COLLECTION_METHODS,
    mutation,
    (provider, request) =>
      request.method === 'GET'
        ? handleListNotes(provider)
        : handleCreateNote(provider, request),
  );
}

/**
 * `GET /api/notes/<path>` reads one note. `PUT /api/notes/<path>` updates it.
 * There is no delete: removing a note stays in Studio, where the folder
 * rules (a folder page, a non-empty folder) already live.
 */
export function notesEntryRoute(context: APIContext): Promise<Response> {
  const path = pathFromParams(context.params.path);
  const mutation = context.request.method === 'PUT';
  return dispatch(
    context.request,
    ENTRY_METHODS,
    mutation,
    (provider, request) =>
      request.method === 'GET'
        ? handleReadNote(provider, path)
        : handleUpdateNote(provider, path, request),
  );
}
