import { isRecord } from '../../../lib/records';

const ADMIN_REQUEST_TIMEOUT_MS = 15_000;
const CONTENT_REQUEST_TIMEOUT_MS = 30_000;

interface AdminApiIssue {
  path: unknown[];
  message: string;
}

class AdminApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly issues: AdminApiIssue[] = [],
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

function withJsonAccept(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  return { ...init, headers };
}

/**
 * `fetch` rejects with DOMExceptions and TypeErrors whose messages are written
 * for a console rather than an operator — an expired `AbortSignal.timeout`
 * surfaces as the literal string "signal timed out". Normalizing every
 * rejection into an `AdminApiError` here is what keeps a caller's error state
 * from rendering a browser internal as if it were advice.
 */
async function sendRequest(
  input: RequestInfo,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new AdminApiError(
        'The admin API did not respond in time. It may still be starting up, or its data store may be unreachable.',
        'timeout',
      );
    }
    // An explicit abort is a caller unmounting or superseding this request, not
    // a fault worth describing as one.
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AdminApiError('The request was cancelled.', 'aborted');
    }
    throw new AdminApiError(
      'Could not reach the admin API. Check that the server is running and reachable.',
      'network',
    );
  }
}

export async function readJson<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const requestInit = withJsonAccept(init);
  requestInit.signal ??= AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS);
  const response = await sendRequest(input, requestInit);
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    // A crashed route answers with an HTML error page, so the status is the
    // only part of the response that still carries a diagnosis.
    throw new AdminApiError(
      `Admin API returned an invalid response (HTTP ${response.status}).`,
      'invalid_response',
    );
  }

  if (!isRecord(payload)) {
    throw new AdminApiError(
      `Admin API returned an invalid response (HTTP ${response.status}).`,
      'invalid_response',
    );
  }

  if (!response.ok) {
    const issues: AdminApiIssue[] = Array.isArray(payload.issues)
      ? payload.issues.flatMap((issue) =>
          isRecord(issue) && typeof issue.message === 'string'
            ? [
                {
                  path: Array.isArray(issue.path) ? issue.path : [],
                  message: issue.message,
                },
              ]
            : [],
        )
      : [];
    throw new AdminApiError(
      typeof payload.error === 'string' && payload.error
        ? payload.error
        : 'Request failed.',
      typeof payload.code === 'string' ? payload.code : undefined,
      issues,
    );
  }

  return payload as T;
}

export function readContentJson<T>(
  input: RequestInfo,
  init: RequestInit = {},
): Promise<T> {
  return readJson<T>(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(CONTENT_REQUEST_TIMEOUT_MS),
  });
}

/** JSON mutations share one encoding; multipart uploads keep their browser boundary. */
export function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
