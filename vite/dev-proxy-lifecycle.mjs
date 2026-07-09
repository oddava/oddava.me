/**
 * Lifecycle helpers for standalone HTTP servers started by Vite plugins
 * during `astro dev`.
 *
 * Without this, proxy sockets keep the Node event loop alive after Ctrl+C /
 * terminal close, which leaves "abandoned" listeners on 45555/45556 (and
 * sometimes the main dev port).
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

  // Vite 5+/6+ exposes this on some versions when the server is stopping.
  if (typeof viteServer.ws?.on === 'function') {
    // no-op; kept for future hooks
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
 * @param {import('node:http').Server | null | undefined} server
 */
export function closeHttpServer(server) {
  if (!server) return;
  try {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
  } catch {
    /* ignore */
  }
  try {
    server.close();
  } catch {
    /* already closed */
  }
}
