import {
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
): Promise<T> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }

  if (shouldUseLocalRedis()) {
    const { executeLocalRedisCommand } = await import('../local-redis');
    return executeLocalRedisCommand<T>(
      namespaceRedisCommand(command),
      getLocalRedisUrl(),
    );
  }

  const { url, token } = getRedisApiConfig();
  const response = await fetchWithTimeout(url!, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
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

export function isStorageUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'Persistent storage is not configured.',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'The client is closed',
    'Connection timeout',
    'Socket closed unexpectedly',
    'fetch failed',
    'aborted',
    'AbortError',
    'No such module',
    'Local Redis proxy failed',
  ].some((fragment) => message.includes(fragment));
}
