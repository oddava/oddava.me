import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(projectRoot, '.astro-build.lock');
const DEV_PORTS = [4321, 4322, 45555];
const SETTLE_MS = 2000;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {string} pid */
function isProcessRunning(pid) {
  try {
    if (platform() === 'win32') {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.includes(pid);
    }

    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireBuildLock() {
  if (existsSync(lockPath)) {
    const pid = readFileSync(lockPath, 'utf8').trim();

    if (pid && isProcessRunning(pid)) {
      console.error(
        `[build] Another build is already running (pid ${pid}). Wait for it to finish.`,
      );
      process.exit(1);
    }

    unlinkSync(lockPath);
  }

  writeFileSync(lockPath, String(process.pid));
}

export function releaseBuildLock() {
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
}

/** @param {number} port */
function freeWindowsPort(port) {
  const portPattern = new RegExp(`:${port}(?:\\s|$)`);

  try {
    const output = execSync('netstat -ano -p tcp', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const pids = new Set();

    for (const line of output.split('\n')) {
      if (!line.includes('LISTENING') || !portPattern.test(line)) continue;

      const pid = line.trim().split(/\s+/).at(-1);
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        pids.add(pid);
      }
    }

    for (const pid of pids) {
      if (pid === String(process.ppid) || pid === String(process.pid)) continue;

      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.info(`[build] Freed port ${port} (pid ${pid})`);
      } catch {
        /* Process may have already exited. */
      }
    }
  } catch {
    /* Port is not in use. */
  }
}

export async function prepareBuildEnvironment() {
  if (platform() === 'win32') {
    for (const port of DEV_PORTS) {
      freeWindowsPort(port);
    }

    await sleep(SETTLE_MS);
  }
}