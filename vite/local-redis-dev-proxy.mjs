import http from 'node:http';

const DEFAULT_PROXY_PORT = 45555;

/** @returns {import('vite').Plugin} */
export function localRedisDevProxy() {
  /** @type {import('http').Server | null} */
  let server = null;
  /** @type {import('redis').RedisClientType | null} */
  let client = null;
  /** @type {string | null} */
  let connectedUrl = null;

  return {
    name: 'local-redis-dev-proxy',
    configureServer(viteServer) {
      if (viteServer.config.command !== 'serve') return;
      if (viteServer.config.mode !== 'development') return;

      const proxyPort = Number(
        process.env.LOCAL_REDIS_PROXY_PORT ?? DEFAULT_PROXY_PORT,
      );

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
              client = createClient({ url });
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
            `[local-redis] Port ${proxyPort} is busy; set LOCAL_REDIS_PROXY_PORT to use another port.`,
          );
          return;
        }

        throw error;
      });

      server.listen(proxyPort, '127.0.0.1', () => {
        console.info(
          `[local-redis] Dev proxy listening on http://127.0.0.1:${proxyPort}/__local_redis`,
        );
      });
    },
    buildEnd() {
      if (client?.isOpen) {
        void client.quit();
      }
      client = null;
      connectedUrl = null;
      server?.close();
      server = null;
    },
  };
}

export { DEFAULT_PROXY_PORT };
