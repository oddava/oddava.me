import { isIntegrationError, toIntegrationError } from './errors';
import type { IntegrationError } from './errors';
import { INTEGRATIONS } from './registry';
import {
  getCredentialStatuses,
  getEnabledMap,
  isConfigured,
  resolveCredentials,
} from './store';
import type {
  IntegrationCheckResult,
  IntegrationDefinition,
  IntegrationId,
  IntegrationStatus,
} from './types';

/**
 * How long a check result is reused. The admin overview is polled on every
 * panel load; without this, opening the dashboard twice would force two live
 * token refreshes against every provider.
 */
const CHECK_CACHE_TTL_MS = 30_000;

/**
 * Circuit breaker. After this many consecutive failures we stop probing and
 * serve the last error until the cooldown elapses. This is what keeps a broken
 * or rate-limited provider from being hammered once per dashboard load.
 */
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60_000;

/** No single provider may stall the whole status list. */
const CHECK_TIMEOUT_MS = 8_000;

interface CheckRecord {
  result: IntegrationCheckResult;
  checkedAt: number;
  consecutiveFailures: number;
  /** Set while the breaker is open; live checks are skipped until then. */
  openUntil: number;
}

const records = new Map<IntegrationId, CheckRecord>();

export function resetIntegrationStatusCache(): void {
  records.clear();
}

function resultForError(error: IntegrationError): IntegrationCheckResult {
  return {
    // A rate limit is the upstream working as designed, not a broken
    // integration — surfacing it as a hard error would train the operator to
    // ignore red.
    state:
      error.code === 'not_configured'
        ? 'unconfigured'
        : error.code === 'rate_limited'
          ? 'degraded'
          : 'error',
    detail: error.message,
    code: error.code,
    retryAfterSeconds: error.retryAfterSeconds,
  };
}

async function withCheckTimeout(
  definition: IntegrationDefinition,
): Promise<IntegrationCheckResult> {
  const credentials = await resolveCredentials(definition);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      definition.check(credentials, controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const timeout = toIntegrationError(
            Object.assign(new Error(`${definition.name} check timed out.`), {
              name: 'TimeoutError',
            }),
            `${definition.name} check timed out.`,
          );
          controller.abort(timeout);
          reject(timeout);
        }, CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runCheck(
  definition: IntegrationDefinition,
): Promise<CheckRecord> {
  const previous = records.get(definition.id);

  let result: IntegrationCheckResult;
  let failed = false;

  try {
    result = await withCheckTimeout(definition);
  } catch (error) {
    const normalized = isIntegrationError(error)
      ? error
      : toIntegrationError(error, `${definition.name} check failed.`);
    result = resultForError(normalized);
    // Credential problems will not fix themselves, but they also cost one cheap
    // failed request rather than a hanging one, and the operator is likely
    // fixing them right now — so they do not trip the breaker.
    failed = !normalized.requiresOperatorAction;
  }

  const consecutiveFailures = failed
    ? (previous?.consecutiveFailures ?? 0) + 1
    : 0;
  const checkedAt = Date.now();

  const record: CheckRecord = {
    result,
    checkedAt,
    consecutiveFailures,
    openUntil:
      consecutiveFailures >= FAILURE_THRESHOLD ? checkedAt + COOLDOWN_MS : 0,
  };

  records.set(definition.id, record);
  return record;
}

/**
 * Returns a check result for a provider, reusing a recent one unless `force`
 * is set and respecting the circuit breaker. Checks are not retained in module
 * scope because they contain request-bound I/O.
 */
async function checkIntegration(
  definition: IntegrationDefinition,
  force: boolean,
): Promise<CheckRecord> {
  const now = Date.now();
  const cached = records.get(definition.id);

  if (!force && cached) {
    if (now < cached.openUntil) return cached;
    if (now - cached.checkedAt < CHECK_CACHE_TTL_MS) return cached;
  }

  // An explicit "Test connection" must reach the upstream even mid-cooldown.
  // Concurrent requests check independently so request-bound promises never
  // cross Worker contexts.
  return runCheck(definition);
}

async function statusFor(
  definition: IntegrationDefinition,
  enabled: boolean,
  force: boolean,
): Promise<IntegrationStatus> {
  const [credentials, configured] = await Promise.all([
    getCredentialStatuses(definition),
    isConfigured(definition),
  ]);

  const base = {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    docsUrl: definition.docsUrl,
    manageable: definition.manageable,
    enabled,
    configured,
    fields: definition.credentials.map(
      ({ validate: _validate, ...field }) => field,
    ),
    credentials,
  } satisfies Omit<IntegrationStatus, 'state' | 'detail'>;

  if (!enabled) {
    return {
      ...base,
      state: 'disabled',
      detail: `${definition.name} is turned off. No requests are made to it.`,
    };
  }

  if (!configured) {
    const missing = definition.credentials
      .filter(
        (field) =>
          field.required &&
          !credentials.find((status) => status.key === field.key)?.set,
      )
      .map((field) => field.label);

    return {
      ...base,
      state: 'unconfigured',
      code: 'not_configured',
      detail: missing.length
        ? `Not configured. Missing: ${missing.join(', ')}.`
        : 'Not configured.',
    };
  }

  const record = await checkIntegration(definition, force);

  return {
    ...base,
    configured: record.result.code === 'not_configured' ? false : configured,
    state: record.result.state,
    detail: record.result.detail,
    code: record.result.code,
    checkedAt: new Date(record.checkedAt).toISOString(),
    retryAt:
      record.openUntil > Date.now()
        ? new Date(record.openUntil).toISOString()
        : undefined,
  };
}

/**
 * Status for every registered integration. Providers are probed in parallel and
 * each failure is contained, so one broken upstream cannot blank the panel.
 */
export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const enabledMap = await getEnabledMap(INTEGRATIONS);

  return Promise.all(
    INTEGRATIONS.map((definition) =>
      statusFor(definition, enabledMap[definition.id], false),
    ),
  );
}

/**
 * Status for one integration, optionally forcing a live check. `force` backs
 * the admin panel's "Test connection" button.
 */
export async function getIntegrationStatus(
  definition: IntegrationDefinition,
  options: { force?: boolean } = {},
): Promise<IntegrationStatus> {
  const enabledMap = await getEnabledMap(INTEGRATIONS);
  return statusFor(
    definition,
    enabledMap[definition.id],
    options.force ?? false,
  );
}

/** Drops any cached check for a provider, so the next read probes it live. */
export function invalidateIntegrationStatus(id: IntegrationId): void {
  records.delete(id);
}

/**
 * Whether an integration should be consulted right now: enabled, configured,
 * and not sitting behind an open circuit breaker. Callers on the request path
 * (the now-playing service) use this to skip providers that are known-bad
 * instead of paying their timeout on every page view.
 */
export async function isIntegrationUsable(
  definition: IntegrationDefinition,
): Promise<boolean> {
  const enabledMap = await getEnabledMap(INTEGRATIONS);
  if (!enabledMap[definition.id]) return false;
  if (!(await isConfigured(definition))) return false;

  const record = records.get(definition.id);
  if (!record) return true;

  if (
    record.result.code === 'not_configured' ||
    record.result.code === 'invalid_credentials' ||
    record.result.code === 'forbidden'
  ) {
    return false;
  }

  return Date.now() >= record.openUntil;
}

/**
 * Feeds a request-path outcome back into the breaker, so the widget polling
 * every few seconds and the admin panel share one view of provider health.
 */
export function recordIntegrationOutcome(
  id: IntegrationId,
  outcome: { ok: true } | { ok: false; error: unknown },
): void {
  const previous = records.get(id);
  const now = Date.now();

  if (outcome.ok) {
    records.set(id, {
      result: { state: 'ok', detail: 'Connected.' },
      checkedAt: now,
      consecutiveFailures: 0,
      openUntil: 0,
    });
    return;
  }

  const error = isIntegrationError(outcome.error)
    ? outcome.error
    : toIntegrationError(outcome.error, 'Request failed.');

  const consecutiveFailures = error.requiresOperatorAction
    ? 0
    : (previous?.consecutiveFailures ?? 0) + 1;

  records.set(id, {
    result: resultForError(error),
    checkedAt: now,
    consecutiveFailures,
    openUntil: consecutiveFailures >= FAILURE_THRESHOLD ? now + COOLDOWN_MS : 0,
  });
}
