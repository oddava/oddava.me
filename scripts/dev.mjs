// Dev entrypoint: free stale ports, regenerate critical CSS, run Astro, and
// guarantee cleanup on Ctrl+C / terminal signals (Windows included).
//
// Abandoned listeners happen when Node exits while proxy HTTP servers still
// hold ports, or when a previous `astro dev` tree is left running. This
// wrapper always freeDevPorts() on the way in and on the way out.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { freeDevPorts } from './build-utils.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const astroCli = join(projectRoot, 'node_modules', 'astro', 'bin', 'astro.mjs');

await freeDevPorts();

const gen = spawnSync(
  process.execPath,
  [join(projectRoot, 'scripts', 'gen-critical.mjs')],
  {
    stdio: 'inherit',
    cwd: projectRoot,
  },
);
if (gen.status !== 0) {
  process.exit(gen.status ?? 1);
}

const child = spawn(
  process.execPath,
  [astroCli, 'dev', '--mode', 'development'],
  {
    stdio: 'inherit',
    cwd: projectRoot,
    env: process.env,
    // Same process group on Unix so Ctrl+C reaches the child too.
    detached: false,
  },
);

let shuttingDown = false;

function killChildTree() {
  if (!child.pid || child.exitCode !== null || child.signalCode) return;

  try {
    if (process.platform === 'win32') {
      // /T kills the whole process tree (astro → vite → workerd helpers).
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* already gone */
  }
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killChildTree();
  await freeDevPorts();
  process.exit(exitCode);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  try {
    process.on(signal, () => {
      void shutdown(0);
    });
  } catch {
    /* signal not supported on this platform */
  }
}

child.on('error', (error) => {
  console.error('[dev] Failed to start Astro:', error.message);
  void shutdown(1);
});

child.on('exit', (code, signal) => {
  if (shuttingDown) return;
  void freeDevPorts().then(() => {
    if (signal) {
      process.exit(0);
    }
    process.exit(code ?? 0);
  });
});
