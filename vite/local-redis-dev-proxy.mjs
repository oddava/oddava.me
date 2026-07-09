import http from 'node:http';
import path from 'node:path';
import { loadEnv } from 'vite';
import {
  closeHttpServer,
  registerDevProxyCleanup,
} from './dev-proxy-lifecycle.mjs';

const DEFAULT_PROXY_PORT = 45555;

/** @returns {import('vite').Plugin} */
export function localRedisDevProxy() {
  /** @type {import('http').Server | null} */
  let server = null;
  /** @type {import('redis').RedisClientType | null} */
  let client = null;
  /** @type {string | null} */
  let connectedUrl = null;
  /** @type {(() => void) | null} */
  let disposeCleanup = null;

  async function shutdown() {
    disposeCleanup?.();
    disposeCleanup = null;

    if (client?.isOpen) {
      try {
        await client.quit();
      } catch {
        try {
          client.disconnect();
        } catch {
          /* ignore */
        }
      }
    }
    client = null;
    connectedUrl = null;
    closeHttpServer(server);
    server = null;
  }

  return {
    name: 'local-redis-dev-proxy',
    configureServer(viteServer) {
      if (viteServer.config.command !== 'serve') return;
      if (viteServer.config.mode !== 'development') return;

      // Hot-reload / reconfigure: tear down previous instance first.
      disposeCleanup?.();
      disposeCleanup = null;
      closeHttpServer(server);
      server = null;
      if (client?.isOpen) {
        void client.quit().catch(() => {
          try {
            client?.disconnect();
          } catch {
            /* ignore */
          }
        });
      }
      client = null;
      connectedUrl = null;

      const envDir = path.dirname(
        viteServer.config.configFile ?? path.resolve('astro.config.mjs'),
      );
      const env = {
        ...loadEnv(viteServer.config.mode, envDir, ''),
        ...process.env,
      };

      const proxyPort = Number(
        env.LOCAL_REDIS_PROXY_PORT ?? DEFAULT_PROXY_PORT,
      );
      const configuredRedisUrl =
        env.LOCAL_REDIS_URL ?? 'redis://127.0.0.1:6379';

      server = http.createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/__local_redis') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const payload = JSON.parse(body);
            const command = payload?.command;
            const url = payload?.url;

            if (!Array.isArray(command) || typeof url !== 'string') {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({ error: 'Invalid Redis proxy payload.' }),
              );
              return;
            }

            const { createClient } = await import('redis');

            if (!client || connectedUrl !== url || !client.isOpen) {
              if (client?.isOpen) {
                await client.quit();
              }
              client = createClient({
                socket: {
                  connectTimeout: 500,
                  reconnectStrategy: false,
                },
                url,
              });
              connectedUrl = url;
              await client.connect();
            }

            const result = await client.sendCommand(command);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ result }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        });
      });

      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.warn(
            `[local-redis] Port ${proxyPort} is busy; run pnpm free:ports or stop the old dev session.`,
          );
          return;
        }

        throw error;
      });

      server.listen(proxyPort, '127.0.0.1', () => {
        console.info(
          `[local-redis] HTTP proxy on http://127.0.0.1:${proxyPort}/__local_redis (forwards to LOCAL_REDIS_URL, e.g. ${configuredRedisUrl})`,
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

export { DEFAULT_PROXY_PORT };
