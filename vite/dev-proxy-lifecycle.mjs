/**
 * Lifecycle helpers for standalone HTTP servers started by Vite plugins
 * during `astro dev`.
 *
 * Without this, proxy sockets keep the Node event loop alive after Ctrl+C /
 * terminal close, which leaves an "abandoned" listener on the local Redis
 * proxy port (and sometimes the main dev port).
 */

/**
 * @param {import('vite').ViteDevServer} viteServer
 * @param {() => void | Promise<void>} cleanup
 * @returns {() => void} dispose registration (for tests / reconfigure)
 */
export function registerDevProxyCleanup(viteServer, cleanup) {
  let cleaned = false;

  const run = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      const result = cleanup();
      if (result && typeof result.then === 'function') {
        void result.catch(() => {
          /* best-effort */
        });
      }
    } catch {
      /* best-effort */
    }
  };

  const httpServer = viteServer.httpServer;
  if (httpServer) {
    httpServer.once('close', run);
  }

  /** @type {NodeJS.Signals[]} */
  const signals = ['SIGINT', 'SIGTERM'];
  if (process.platform === 'win32') {
    signals.push('SIGBREAK');
  } else {
    signals.push('SIGHUP');
  }

  for (const signal of signals) {
    process.once(signal, run);
  }

  process.once('beforeExit', run);
  process.once('exit', run);

  return () => {
    cleaned = true;
    if (httpServer) {
      httpServer.off('close', run);
    }
    for (const signal of signals) {
      process.off(signal, run);
    }
    process.off('beforeExit', run);
    process.off('exit', run);
  };
}

/**
 * Close an HTTP server and drop active connections (Node 18.2+).
 * Resolves once the port is released so a reconfigure can re-bind safely.
 * @param {import('node:http').Server | null | undefined} server
 * @returns {Promise<void>}
 */
export function closeHttpServer(server) {
  if (!server) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    } catch {
      /* ignore */
    }

    try {
      server.close(done);
    } catch {
      done();
      return;
    }

    // close() may never call back if the server never finished listening.
    setTimeout(done, 500);
  });
}
