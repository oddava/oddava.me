import { DEFAULT_FETCH_TIMEOUT_MS } from './config';

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
