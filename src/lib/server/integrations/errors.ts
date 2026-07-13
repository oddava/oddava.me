import type { IntegrationErrorCode } from '../../contracts';

export type { IntegrationErrorCode } from '../../contracts';

const ERROR_CODES: ReadonlySet<string> = new Set<IntegrationErrorCode>([
  'not_configured',
  'invalid_credentials',
  'forbidden',
  'rate_limited',
  'upstream_unavailable',
  'network_error',
  'invalid_response',
  'unknown',
]);

/**
 * Codes that mean "the operator must do something" — retrying with the same
 * credentials can never succeed, so callers must not burn requests on them.
 */
const OPERATOR_ACTION_CODES: ReadonlySet<IntegrationErrorCode> = new Set([
  'not_configured',
  'invalid_credentials',
  'forbidden',
]);

const RETRYABLE_CODES: ReadonlySet<IntegrationErrorCode> = new Set([
  'rate_limited',
  'upstream_unavailable',
  'network_error',
]);

export interface IntegrationErrorOptions {
  code: IntegrationErrorCode;
  message: string;
  status?: number;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor({
    code,
    message,
    status,
    retryAfterSeconds,
    cause,
  }: IntegrationErrorOptions) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'IntegrationError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** Whether re-issuing the same request could plausibly succeed. */
  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  /** Whether the operator must supply new credentials to recover. */
  get requiresOperatorAction(): boolean {
    return OPERATOR_ACTION_CODES.has(this.code);
  }
}

/**
 * Structural rather than `instanceof`: module graphs get duplicated (bundle
 * chunking, test isolation), and an `instanceof` check that silently fails
 * across two copies of this file would downgrade every classified error back to
 * `unknown` — losing exactly the information the callers branch on.
 */
export function isIntegrationError(error: unknown): error is IntegrationError {
  return (
    error instanceof Error &&
    error.name === 'IntegrationError' &&
    ERROR_CODES.has((error as IntegrationError).code)
  );
}

/**
 * Normalizes an arbitrary thrown value into an IntegrationError so callers
 * never have to branch on `unknown`.
 */
export function toIntegrationError(
  error: unknown,
  fallbackMessage: string,
): IntegrationError {
  if (isIntegrationError(error)) return error;

  if (error instanceof Error) {
    // AbortController-based timeouts surface as DOMException/AbortError.
    const aborted =
      error.name === 'AbortError' || error.name === 'TimeoutError';
    return new IntegrationError({
      code: aborted ? 'network_error' : 'unknown',
      message: aborted ? 'The request timed out.' : error.message,
      cause: error,
    });
  }

  return new IntegrationError({
    code: 'unknown',
    message: fallbackMessage,
    cause: error,
  });
}

/** Maps an upstream HTTP status onto the shared error vocabulary. */
export function codeForHttpStatus(status: number): IntegrationErrorCode {
  if (status === 401) return 'invalid_credentials';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_unavailable';
  return 'unknown';
}
