import type { RedisClientType } from 'redis';
import { getServerEnv } from './env';

let client: RedisClientType | null = null;

const DEFAULT_LOCAL_REDIS_PROXY_PORT = 45555;

function getLocalRedisDevProxyUrl(): string {
  const configured = getServerEnv('LOCAL_REDIS_PROXY_URL');
  if (configured) return configured;

  const port =
    getServerEnv('LOCAL_REDIS_PROXY_PORT') ??
    String(DEFAULT_LOCAL_REDIS_PROXY_PORT);
  return `http://127.0.0.1:${port}/__local_redis`;
}

function shouldUseDevProxy(): boolean {
  return import.meta.env.DEV && !import.meta.env.VITEST;
}

async function executeViaDevProxy<T>(
  command: string[],
  url: string,
): Promise<T> {
  const response = await fetch(getLocalRedisDevProxyUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, url }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    result?: T;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(
      payload.error ?? `Local Redis proxy failed (${response.status}).`,
    );
  }

  return payload.result as T;
}

export async function executeLocalRedisCommand<T>(
  command: string[],
  url: string,
): Promise<T> {
  if (shouldUseDevProxy()) {
    return executeViaDevProxy<T>(command, url);
  }

  if (!client) {
    const packageName = 'redis';
    const { createClient } = (await import(
      /* @vite-ignore */ packageName
    )) as typeof import('redis');
    client = createClient({ url });
  }

  if (!client.isOpen) {
    await client.connect();
  }

  return (await client.sendCommand(command)) as T;
}

export async function closeLocalRedisConnection(): Promise<void> {
  if (!client?.isOpen) return;
  await client.quit();
  client = null;
}
