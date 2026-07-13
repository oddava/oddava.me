import { fetchWithTimeout } from '../community';
import {
  codeForHttpStatus,
  IntegrationError,
  toIntegrationError,
} from './errors';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 2_000;
/**
 * Upper bound on how long we will sit on a `Retry-After` before giving up and
 * surfacing the rate limit. Spotify can hand out multi-hour values; blocking a
 * request on one would be worse than reporting the limit.
 */
const MAX_HONORED_RETRY_AFTER_MS = 3_000;
const MAX_ERROR_RESPONSE_BYTES = 4 * 1024;
const MAX_JSON_RESPONSE_BYTES = 512 * 1024;

export interface IntegrationRequestOptions extends RequestInit {
  /** Per-attempt timeout. Total wall time is roughly attempts × timeoutMs. */
  timeoutMs?: number;
  /** Total attempts including the first. 1 disables retries. */
  attempts?: number;
  /** Used in error messages so failures name the integration that produced them. */
  label: string;
}

/**
 * Parses `Retry-After`, which may be either delta-seconds or an HTTP date.
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;

  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function backoffDelayMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined) {
    return Math.min(retryAfterSeconds * 1000, MAX_HONORED_RETRY_AFTER_MS);
  }

  // Exponential backoff with full jitter, so concurrent callers recovering
  // from the same upstream blip do not resynchronize into a thundering herd.
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.random() * ceiling;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RangeError('Integration response exceeded the size limit.');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError('Integration response exceeded the size limit.');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return text + decoder.decode();
}

async function errorForResponse(
  response: Response,
  label: string,
): Promise<IntegrationError> {
  const code = codeForHttpStatus(response.status);
  const retryAfterSeconds = parseRetryAfter(
    response.headers.get('Retry-After'),
  );

  // Read the body defensively: many APIs describe the failure there, but a
  // failed read must never mask the status code we already have.
  let detail = '';
  try {
    detail = (await readBoundedText(response, MAX_ERROR_RESPONSE_BYTES))
      .slice(0, 200)
      .trim();
  } catch {
    detail = '';
  }

  const message =
    code === 'rate_limited'
      ? `${label} rate limit reached${
          retryAfterSeconds === undefined
            ? '.'
            : `; retry in ${retryAfterSeconds}s.`
        }`
      : `${label} request failed with ${response.status}${
          detail ? `: ${detail}` : '.'
        }`;

  return new IntegrationError({
    code,
    message,
    status: response.status,
    retryAfterSeconds,
  });
}

/**
 * Fetches with a per-attempt timeout and bounded retries. Retries only on
 * failures that can plausibly resolve themselves (network faults, 5xx, and
 * rate limits with a short Retry-After); 4xx credential problems fail fast.
 */
export async function integrationFetch(
  url: string,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attempts = DEFAULT_ATTEMPTS,
    label,
    ...init
  }: IntegrationRequestOptions,
): Promise<Response> {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError(
      'Integration request attempts must be a positive integer.',
    );
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Integration request timeout must be positive.');
  }

  let lastError: IntegrationError | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let error: IntegrationError;

    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);
      if (response.ok || response.status === 204) return response;

      error = await errorForResponse(response, label);
    } catch (cause) {
      if (init.signal?.aborted) throw init.signal.reason ?? cause;
      const normalized = toIntegrationError(cause, `${label} request failed.`);
      error = new IntegrationError({
        code: 'network_error',
        message:
          normalized.code === 'network_error'
            ? `${label} is unreachable: ${normalized.message}`
            : `${label} request failed: ${normalized.message}`,
        cause,
      });
    }

    lastError = error;

    const isLastAttempt = attempt === attempts - 1;
    if (isLastAttempt || !error.retryable) break;

    // A long Retry-After means the limit will outlive this request; surface it
    // instead of sleeping through the caller's own timeout budget.
    if (
      error.code === 'rate_limited' &&
      error.retryAfterSeconds !== undefined &&
      error.retryAfterSeconds * 1000 > MAX_HONORED_RETRY_AFTER_MS
    ) {
      break;
    }

    await sleep(backoffDelayMs(attempt, error.retryAfterSeconds), init.signal);
  }

  throw (
    lastError ??
    new IntegrationError({
      code: 'unknown',
      message: `${label} request failed.`,
    })
  );
}

/** `integrationFetch` plus a guarded JSON parse. */
export async function integrationFetchJson<T>(
  url: string,
  options: IntegrationRequestOptions,
): Promise<T> {
  const response = await integrationFetch(url, options);

  return parseIntegrationJson<T>(response, options.label);
}

/** Parses a response already fetched by a provider without unbounded buffering. */
export async function parseIntegrationJson<T>(
  response: Response,
  label: string,
): Promise<T> {
  try {
    return JSON.parse(
      await readBoundedText(response, MAX_JSON_RESPONSE_BYTES),
    ) as T;
  } catch (cause) {
    throw new IntegrationError({
      code: 'invalid_response',
      message:
        cause instanceof RangeError
          ? `${label} returned a response larger than ${MAX_JSON_RESPONSE_BYTES} bytes.`
          : `${label} returned a malformed JSON response.`,
      status: response.status,
      cause,
    });
  }
}
