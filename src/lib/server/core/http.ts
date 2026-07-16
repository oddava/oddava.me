import { DEFAULT_FETCH_TIMEOUT_MS } from './config';

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  // Abort with a named reason rather than the default. Our own deadline and the
  // caller hanging up both surface as an aborted fetch, and callers have to tell
  // them apart: a timeout is the upstream failing us, while a disconnect means
  // nobody is waiting for the answer. Without a reason, both arrive as an
  // indistinguishable AbortError.
  const timeout = setTimeout(
    () =>
      controller.abort(
        Object.assign(
          new Error(`The request timed out after ${timeoutMs}ms.`),
          {
            name: 'TimeoutError',
          },
        ),
      ),
    timeoutMs,
  );
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, {
        once: true,
      });
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  if (!headers.has('X-Content-Type-Options')) {
    headers.set('X-Content-Type-Options', 'nosniff');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}
