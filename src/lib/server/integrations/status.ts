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
 *
 * This cache is the only thing bounding how often a provider is probed. It is
 * per-isolate and best-effort: a cold isolate probes once. That is the intended
 * ceiling — the request path has its own, tighter cache in `now-playing`, and
 * neither is a coordination mechanism.
 */
const CHECK_CACHE_TTL_MS = 30_000;

/** No single provider may stall the whole status list. */
const CHECK_TIMEOUT_MS = 8_000;

interface CheckRecord {
  result: IntegrationCheckResult;
  checkedAt: number;
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
  let result: IntegrationCheckResult;

  try {
    result = await withCheckTimeout(definition);
  } catch (error) {
    const normalized = isIntegrationError(error)
      ? error
      : toIntegrationError(error, `${definition.name} check failed.`);
    result = resultForError(normalized);
  }

  const record: CheckRecord = { result, checkedAt: Date.now() };
  records.set(definition.id, record);
  return record;
}

/**
 * Returns a check result for a provider, reusing a recent one unless `force` is
 * set. Checks are not retained in module scope because they contain
 * request-bound I/O.
 */
async function checkIntegration(
  definition: IntegrationDefinition,
  force: boolean,
): Promise<CheckRecord> {
  const cached = records.get(definition.id);

  if (!force && cached && Date.now() - cached.checkedAt < CHECK_CACHE_TTL_MS) {
    return cached;
  }

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
 * Whether an integration should be consulted right now: enabled by the operator
 * and holding every credential it requires.
 *
 * This deliberately does not consider recent failures. A failing provider is
 * bounded by the caller's own response cache, and a per-isolate failure record
 * cannot describe a fleet of isolates it has no view of — it only made the
 * request path pay a storage read to answer a question it would learn from the
 * upstream anyway.
 */
export async function isIntegrationUsable(
  definition: IntegrationDefinition,
): Promise<boolean> {
  const enabledMap = await getEnabledMap(INTEGRATIONS);
  if (!enabledMap[definition.id]) return false;
  return isConfigured(definition);
}
