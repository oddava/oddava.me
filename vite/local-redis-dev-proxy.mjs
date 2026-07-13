import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { loadEnv } from 'vite';
import {
  closeHttpServer,
  registerDevProxyCleanup,
} from './dev-proxy-lifecycle.mjs';
import { firstConfiguredSecret } from './dev-secrets.mjs';

const DEFAULT_PROXY_PORT = 45555;
const MAX_REQUEST_BYTES = 64 * 1024;
const PROXY_PATH = '/__local_redis';
const TOKEN_HEADER = 'x-local-redis-token';

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

/** @param {string | string[] | undefined} actual @param {string | undefined} expected */
function matchesToken(actual, expected) {
  if (typeof actual !== 'string' || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

/** @param {string} value */
function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid LOCAL_REDIS_PROXY_PORT: ${value}`);
  }
  return port;
}

/** @param {string} value */
function validateRedisUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('LOCAL_REDIS_URL must use the redis: or rediss: protocol.');
  }
  return value;
}

/** @returns {import('vite').Plugin} */
export function localRedisDevProxy() {
  /** @type {import('http').Server | null} */
  let server = null;
  /** @type {import('redis').RedisClientType | null} */
  let client = null;
  /** @type {Promise<import('redis').RedisClientType> | null} */
  let connection = null;
  /** @type {(() => void) | null} */
  let disposeCleanup = null;

  async function closeClient() {
    const activeClient = client;
    client = null;
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

  /** @param {string} redisUrl */
  async function getClient(redisUrl) {
    if (client?.isReady) return client;
    if (connection) return connection;

    connection = (async () => {
      await closeClient();
      const { createClient } = await import('redis');
      const nextClient = createClient({
        socket: {
          connectTimeout: 500,
          reconnectStrategy: false,
        },
        url: redisUrl,
      });
      nextClient.on('error', (error) => {
        console.warn(`[local-redis] ${error.message}`);
      });

      try {
        await nextClient.connect();
        client = nextClient;
        return nextClient;
      } catch (error) {
        nextClient.destroy();
        throw error;
      }
    })().finally(() => {
      connection = null;
    });

    return connection;
  }

  async function shutdown() {
    disposeCleanup?.();
    disposeCleanup = null;
    closeHttpServer(server);
    server = null;

    if (connection) {
      try {
        await connection;
      } catch {
        // A failed connection has already destroyed its client.
      }
    }
    await closeClient();
  }

  return {
    name: 'local-redis-dev-proxy',
    async configureServer(viteServer) {
      if (viteServer.config.command !== 'serve') return;
      if (viteServer.config.mode !== 'development') return;

      // A Vite config reload can re-run this hook on the same plugin instance.
      await shutdown();

      const envDir = path.dirname(
        viteServer.config.configFile ?? path.resolve('astro.config.mjs'),
      );
      const env = {
        ...loadEnv(viteServer.config.mode, envDir, ''),
        ...process.env,
      };
      const proxyPort = parsePort(
        env.LOCAL_REDIS_PROXY_PORT ?? String(DEFAULT_PROXY_PORT),
      );
      const configuredRedisUrl = validateRedisUrl(
        env.LOCAL_REDIS_URL ?? 'redis://127.0.0.1:6379',
      );
      const proxyToken = firstConfiguredSecret(
        env.LOCAL_REDIS_PROXY_TOKEN,
        env.COMMUNITY_SIGNING_SECRET,
      );

      if (!proxyToken) {
        console.warn(
          '[local-redis] Proxy is locked until LOCAL_REDIS_PROXY_TOKEN or COMMUNITY_SIGNING_SECRET is configured.',
        );
      }

      server = http.createServer((request, response) => {
        if (request.url !== PROXY_PATH) {
          sendJson(response, 404, { error: 'Not found.' });
          return;
        }
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }
        if (
          request.headers['content-type']
            ?.split(';', 1)[0]
            ?.trim()
            .toLowerCase() !== 'application/json'
        ) {
          sendJson(response, 415, { error: 'Expected application/json.' });
          return;
        }
        if (!matchesToken(request.headers[TOKEN_HEADER], proxyToken)) {
          sendJson(response, 401, { error: 'Invalid local proxy token.' });
          return;
        }

        /** @type {Buffer[]} */
        const bodyChunks = [];
        let byteLength = 0;
        let tooLarge = false;
        request.on('data', (chunk) => {
          byteLength += chunk.length;
          if (byteLength > MAX_REQUEST_BYTES) {
            tooLarge = true;
            return;
          }
          bodyChunks.push(Buffer.from(chunk));
        });

        request.on('end', async () => {
          if (tooLarge) {
            sendJson(response, 413, {
              error: 'Redis proxy payload is too large.',
            });
            return;
          }

          let command;
          try {
            const body = Buffer.concat(bodyChunks).toString('utf8');
            command = JSON.parse(body)?.command;
          } catch {
            sendJson(response, 400, { error: 'Invalid JSON payload.' });
            return;
          }

          if (
            !Array.isArray(command) ||
            command.length === 0 ||
            !command.every((argument) => typeof argument === 'string')
          ) {
            sendJson(response, 400, {
              error: 'Redis command must be a non-empty string array.',
            });
            return;
          }

          try {
            const redisClient = await getClient(configuredRedisUrl);
            const result = await redisClient.sendCommand(command);
            sendJson(response, 200, { result });
          } catch (error) {
            sendJson(response, 502, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      });

      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.warn(
            `[local-redis] Port ${proxyPort} is busy; stop the old dev session or set LOCAL_REDIS_PROXY_PORT.`,
          );
          return;
        }
        console.error('[local-redis] Proxy server failed.', error);
      });

      server.listen(proxyPort, '127.0.0.1', () => {
        console.info(
          `[local-redis] Authenticated proxy on http://127.0.0.1:${proxyPort}${PROXY_PATH}.`,
        );
      });

      disposeCleanup = registerDevProxyCleanup(viteServer, () => {
        void shutdown();
      });
    },
    buildEnd() {
      void shutdown();
    },
  };
}
