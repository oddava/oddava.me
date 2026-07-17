import type { RedisClientType } from 'redis';
import { fetchWithTimeout } from './core';
import { getServerEnv } from './env';
import { firstConfiguredSecret } from './secrets';

let client: RedisClientType | null = null;
let clientUrl: string | null = null;
let connection: Promise<RedisClientType> | null = null;

const DEFAULT_LOCAL_REDIS_PROXY_PORT = 45555;
const LOCAL_REDIS_PROXY_TIMEOUT_MS = 3_000;

function getLocalRedisDevProxyUrl(): string {
  const configured = getServerEnv('LOCAL_REDIS_PROXY_URL');
  if (configured) return configured;

  const port =
    getServerEnv('LOCAL_REDIS_PROXY_PORT') ??
    String(DEFAULT_LOCAL_REDIS_PROXY_PORT);
  // Miniflare/workerd routes the localhost hostname to host-side development
  // services. A raw 127.0.0.1 URL can fail inside its Windows runtime even
  // though the Node bridge is reachable from the host process.
  return `http://localhost:${port}/__local_redis`;
}

function shouldUseDevProxy(): boolean {
  return import.meta.env.DEV && !import.meta.env.VITEST;
}

function getLocalRedisDevProxyToken(): string {
  const token = firstConfiguredSecret(
    getServerEnv('LOCAL_REDIS_PROXY_TOKEN'),
    getServerEnv('COMMUNITY_SIGNING_SECRET'),
  );
  if (!token) {
    throw new Error(
      'LOCAL_REDIS_PROXY_TOKEN or COMMUNITY_SIGNING_SECRET is required in local development.',
    );
  }
  return token;
}

async function executeViaDevProxy<T>(
  command: string[],
  timeoutMs: number,
): Promise<T> {
  const response = await fetchWithTimeout(
    getLocalRedisDevProxyUrl(),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Local-Redis-Token': getLocalRedisDevProxyToken(),
      },
      body: JSON.stringify({ command }),
    },
    timeoutMs,
  );
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

async function closeDirectClient(): Promise<void> {
  const activeClient = client;
  client = null;
  clientUrl = null;
  if (!activeClient) return;

  try {
    if (activeClient.isOpen) {
      await activeClient.quit();
    } else {
      activeClient.destroy();
    }
  } catch {
    activeClient.destroy();
  }
}

async function getDirectClient(url: string): Promise<RedisClientType> {
  if (client?.isReady && clientUrl === url) return client;
  if (connection) {
    await connection;
    return getDirectClient(url);
  }

  connection = (async () => {
    await closeDirectClient();
    const packageName = 'redis';
    const { createClient } = (await import(
      /* @vite-ignore */ packageName
    )) as typeof import('redis');
    const nextClient = createClient({
      socket: {
        connectTimeout: 500,
        reconnectStrategy: false,
      },
      url,
    });
    nextClient.on('error', (error) => {
      console.warn(`[local-redis] ${error.message}`);
    });

    try {
      await nextClient.connect();
      client = nextClient;
      clientUrl = url;
      return nextClient;
    } catch (error) {
      nextClient.destroy();
      throw error;
    }
  })();

  try {
    return await connection;
  } finally {
    connection = null;
  }
}

export async function executeLocalRedisCommand<T>(
  command: string[],
  url: string,
  timeoutMs = LOCAL_REDIS_PROXY_TIMEOUT_MS,
): Promise<T> {
  if (shouldUseDevProxy()) {
    return executeViaDevProxy<T>(command, timeoutMs);
  }

  const directClient = await getDirectClient(url);
  return (await directClient.sendCommand(command)) as T;
}

export async function closeLocalRedisConnection(): Promise<void> {
  if (connection) {
    try {
      await connection;
    } catch {
      // A failed connection already destroyed its client.
    }
  }
  await closeDirectClient();
}
