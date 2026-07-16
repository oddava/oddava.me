import {
  DEFAULT_FETCH_TIMEOUT_MS,
  getLocalRedisUrl,
  getRedisApiConfig,
  getStorageNamespacePrefix,
  logRuntimeEnvironment,
  shouldUseLocalRedis,
} from './config';
import { fetchWithTimeout, json } from './http';

type RedisArgument = string | number;

function withNamespace(rawKey: string): string {
  return `${getStorageNamespacePrefix()}${rawKey}`;
}

function namespaceRedisCommand(command: RedisArgument[]): string[] {
  const normalized = command.map(String);
  const operation = normalized[0]?.toUpperCase();

  if (operation === 'EVAL' || operation === 'EVALSHA') {
    const keyCount = Number(normalized[2] ?? 0);
    for (let index = 0; index < keyCount; index += 1) {
      const keyIndex = 3 + index;
      normalized[keyIndex] = withNamespace(normalized[keyIndex]);
    }
    return normalized;
  }

  if (operation === 'MGET' || operation === 'DEL' || operation === 'UNLINK') {
    for (let index = 1; index < normalized.length; index += 1) {
      normalized[index] = withNamespace(normalized[index]);
    }
    return normalized;
  }

  if (normalized[1]) {
    normalized[1] = withNamespace(normalized[1]);
  }
  return normalized;
}

export function hasRedisConfig(): boolean {
  logRuntimeEnvironment();
  if (shouldUseLocalRedis()) return true;

  const { url, token } = getRedisApiConfig();
  return Boolean(url && token);
}

export async function redisCommand<T = unknown>(
  command: RedisArgument[],
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }

  const namespacedCommand = namespaceRedisCommand(command);

  if (shouldUseLocalRedis()) {
    const { executeLocalRedisCommand } = await import('../local-redis');
    return executeLocalRedisCommand<T>(
      namespacedCommand,
      getLocalRedisUrl(),
      timeoutMs,
    );
  }

  const { url, token } = getRedisApiConfig();
  const response = await fetchWithTimeout(
    url!,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(namespacedCommand),
    },
    timeoutMs,
  );
  const payload = (await response.json().catch(() => ({}))) as {
    result?: T;
    error?: string;
  };

  if (!response.ok || payload.error) {
    throw new Error(
      `Redis command failed: ${response.status} ${payload.error ?? 'Unknown error'}`,
    );
  }

  return payload.result as T;
}

export function rejectIfStorageUnavailable(): Response | null {
  if (hasRedisConfig()) return null;
  return json(
    {
      error:
        'This shared feature is temporarily unavailable because persistent storage is not configured.',
      code: 'storage_unavailable',
    },
    { status: 503 },
  );
}

/**
 * Messages the storage layer produces verbatim. Matched whole: `fetch failed`
 * as a substring also matches a message that merely quotes a failed fetch.
 */
const STORAGE_ERROR_MESSAGES: ReadonlySet<string> = new Set([
  'Persistent storage is not configured.',
  'fetch failed',
]);

/**
 * Driver and transport markers. These are distinctive enough that a substring
 * match cannot plausibly hit anything else.
 */
const STORAGE_ERROR_FRAGMENTS = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'The client is closed',
  'Connection timeout',
  'Socket closed unexpectedly',
  'No such module',
  'Local Redis proxy failed',
];

/**
 * Whether an error means "the store could not answer", which callers degrade on
 * rather than fail on.
 *
 * The abort cases are the subtle ones. `fetchWithTimeout` aborts with a named
 * TimeoutError when *our* deadline expires — the store failing us, so: yes. A
 * plain AbortError means the request was cancelled from the other end, i.e. the
 * visitor navigated away. Nothing about the store is known to be wrong, and
 * there is no longer anyone to serve, so treating it as a storage outage
 * misreports a client disconnect as infrastructure down. Matching the substring
 * `aborted` could not tell those apart, and answered "outage" to both.
 */
export function isStorageUnavailableError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'TimeoutError') return true;
  if (error instanceof Error && error.name === 'AbortError') return false;

  const message = error instanceof Error ? error.message : String(error);
  return (
    STORAGE_ERROR_MESSAGES.has(message) ||
    STORAGE_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment))
  );
}
