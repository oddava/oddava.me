import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(projectRoot, '.astro-build.lock');

/** Astro dev + local Redis/content HTTP proxies. */
export const DEV_PORTS = [4321, 4322, 45555, 45556];
const SETTLE_MS = 2000;
const DEV_SETTLE_MS = 500;

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

/**
 * @param {number[]} ports
 * @returns {Map<string, number[]>} pid → ports
 */
function findWindowsListeners(ports) {
  /** @type {Map<string, number[]>} */
  const byPid = new Map();

  try {
    const output = execSync('netstat -ano -p tcp', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;

      for (const port of ports) {
        // Match :PORT as a full port token (avoid 14321 matching 4321).
        const portPattern = new RegExp(`:${port}(?=\\s)`);
        if (!portPattern.test(line)) continue;

        const pid = line.trim().split(/\s+/).at(-1);
        if (!pid || !/^\d+$/.test(pid) || pid === '0') continue;
        if (pid === String(process.pid) || pid === String(process.ppid)) {
          continue;
        }

        const list = byPid.get(pid) ?? [];
        if (!list.includes(port)) list.push(port);
        byPid.set(pid, list);
      }
    }
  } catch {
    /* netstat unavailable */
  }

  return byPid;
}

/**
 * @param {number[]} ports
 * @returns {Map<string, number[]>}
 */
function findUnixListeners(ports) {
  /** @type {Map<string, number[]>} */
  const byPid = new Map();

  for (const port of ports) {
    try {
      const output = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      if (!output) continue;

      for (const pid of output.split(/\s+/)) {
        if (
          !pid ||
          pid === String(process.pid) ||
          pid === String(process.ppid)
        ) {
          continue;
        }
        const list = byPid.get(pid) ?? [];
        if (!list.includes(port)) list.push(port);
        byPid.set(pid, list);
      }
    } catch {
      /* Port free or lsof missing */
    }
  }

  return byPid;
}

/**
 * Kill listeners on dev/proxy ports left over from previous runs.
 * @param {{ ports?: number[], settleMs?: number }} [options]
 * @returns {Promise<boolean>} whether any process was killed
 */
export async function freeDevPorts(options = {}) {
  const ports = options.ports ?? DEV_PORTS;
  const settleMs = options.settleMs ?? DEV_SETTLE_MS;
  const byPid =
    platform() === 'win32'
      ? findWindowsListeners(ports)
      : findUnixListeners(ports);

  if (byPid.size === 0) {
    return false;
  }

  let freed = false;

  for (const [pid, heldPorts] of byPid) {
    try {
      if (platform() === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else {
        process.kill(Number(pid), 'SIGTERM');
      }
      console.info(
        `[dev-ports] Freed port(s) ${heldPorts.join(', ')} (pid ${pid})`,
      );
      freed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[dev-ports] Could not free port(s) ${heldPorts.join(', ')} (pid ${pid}): ${message}`,
      );
    }
  }

  if (freed) {
    await sleep(settleMs);
  }

  return freed;
}

export async function prepareBuildEnvironment() {
  await freeDevPorts({ settleMs: SETTLE_MS });
}
