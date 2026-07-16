import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mirrors MUTATION_LOCK_KEY / MUTATION_LOCK_TTL_MS in
// src/lib/server/content/redis-store.ts, which owns the lock's semantics. These
// scripts run under bare `node`, so they cannot import the .ts; the copy is
// enforced instead — tests/content-lock.test.ts reads both files and fails if
// they disagree. Change the .ts first.
export const MUTATION_LOCK_KEY = 'content:mutation-lock';
export const LOCK_TTL_MS = 5 * 60 * 1000;
const PLACEHOLDERS = new Set([
  'change-me',
  'changeme',
  'replace-me',
  'replace_me',
]);

export const CONTENT_KEYS = {
  files: 'content:files',
  directories: 'content:dirs',
  version: 'content:version',
  file: (path) => `content:file:${path}`,
};

export function loadEnvironment(projectRoot) {
  const environment = { ...process.env };
  try {
    const source = readFileSync(join(projectRoot, '.env'), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 0) continue;
      const name = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(name in environment)) environment[name] = value;
    }
  } catch {
    // A .env file is optional; process environment values are sufficient.
  }
  return environment;
}

export function resolveTarget(environment, explicitTarget) {
  if (explicitTarget && !['local', 'prod'].includes(explicitTarget)) {
    throw new Error('--target must be either local or prod.');
  }
  if (explicitTarget) return explicitTarget;
  const mode = environment.REDIS_MODE ?? environment.APP_ENV;
  return mode === 'upstash' || mode === 'production' ? 'prod' : 'local';
}

/**
 * Mirrors firstConfiguredSecret in src/lib/server/secrets.ts, which owns this
 * rule. These scripts run under bare `node` and cannot import the .ts;
 * tests/storage-namespace.test.ts checks the two agree. Change the .ts first.
 *
 * It decides whether a credential is real, so drifting apart means one side
 * accepts an example-file placeholder as a live secret.
 */
export function firstConfiguredSecret(...values) {
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const normalized = value.trim().toLowerCase();
    if (
      normalized.startsWith('your_') ||
      normalized.endsWith('_here') ||
      PLACEHOLDERS.has(normalized)
    ) {
      continue;
    }
    return value.trim();
  }
  return undefined;
}

/**
 * The key namespace for a sync target, mirroring getStorageNamespacePrefix in
 * src/lib/server/core/config.ts. Enforced by tests/storage-namespace.test.ts.
 *
 * The app decides this from APP_ENV alone; these scripts also have a target,
 * because `--target=prod` writes production data from a developer's machine,
 * where APP_ENV says development. So: prod is production data by definition,
 * and a local target mirrors the app's own rule — which defaults to
 * development unless APP_ENV explicitly says production.
 *
 * It used to fall back to NODE_ENV when APP_ENV was unset, which the app never
 * does. `NODE_ENV=production notes:migrate -- --target=local` therefore wrote
 * un-prefixed keys that the dev server, reading `dev:`, could not see.
 */
export function storageNamespacePrefix(target, environment) {
  const production = target === 'prod' || environment.APP_ENV === 'production';
  return production ? '' : 'dev:';
}

export function namespaceCommand(command, prefix) {
  const normalized = command.map(String);
  if (!prefix) return normalized;
  const operation = normalized[0]?.toUpperCase();

  if (operation === 'EVAL' || operation === 'EVALSHA') {
    const keyCount = Number(normalized[2] ?? 0);
    for (let index = 0; index < keyCount; index += 1) {
      const keyIndex = 3 + index;
      normalized[keyIndex] = `${prefix}${normalized[keyIndex]}`;
    }
    return normalized;
  }
  if (operation === 'MGET' || operation === 'DEL' || operation === 'UNLINK') {
    for (let index = 1; index < normalized.length; index += 1) {
      normalized[index] = `${prefix}${normalized[index]}`;
    }
    return normalized;
  }
  if (normalized[1]) normalized[1] = `${prefix}${normalized[1]}`;
  return normalized;
}

export async function createRedisTransport(target, environment) {
  const prefix = storageNamespacePrefix(target, environment);

  if (target === 'local') {
    const url = environment.LOCAL_REDIS_URL ?? 'redis://127.0.0.1:6379';
    const { createClient } = await import('redis');
    const client = createClient({
      url,
      socket: { connectTimeout: 2_000, reconnectStrategy: false },
    });
    client.on('error', (error) => {
      console.warn(`[content-sync] ${error.message}`);
    });
    await client.connect();
    return {
      prefix,
      target,
      command(command) {
        return client.sendCommand(namespaceCommand(command, prefix));
      },
      async close() {
        if (client.isOpen) await client.quit();
      },
    };
  }

  const url = firstConfiguredSecret(
    environment.UPSTASH_REDIS_REST_URL,
    environment.UPSTASH_REDIS_REST_KV_REST_API_URL,
  );
  const token = firstConfiguredSecret(
    environment.UPSTASH_REDIS_REST_TOKEN,
    environment.UPSTASH_REDIS_REST_KV_REST_API_TOKEN,
  );
  if (!url || !token) {
    throw new Error(
      'Missing UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for the prod target.',
    );
  }

  return {
    prefix,
    target,
    async command(command) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(namespaceCommand(command, prefix)),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        throw new Error(
          `Redis command failed (${response.status}): ${payload.error ?? 'unknown error'}`,
        );
      }
      return payload.result;
    },
    async close() {},
  };
}

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function withContentLock(transport, operation) {
  const token = crypto.randomUUID();
  const acquired = await transport.command([
    'SET',
    MUTATION_LOCK_KEY,
    token,
    'NX',
    'PX',
    LOCK_TTL_MS,
  ]);
  if (acquired !== 'OK') {
    throw new Error(
      'The content store is busy with another Studio or sync operation.',
    );
  }

  try {
    return await operation();
  } finally {
    await transport
      .command(['EVAL', RELEASE_LOCK_SCRIPT, 1, MUTATION_LOCK_KEY, token])
      .catch((error) => {
        console.warn(`[content-sync] Could not release lock: ${error.message}`);
      });
  }
}

export function ancestorsOfDirectory(directory) {
  const parts = directory.split('/').filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

export function parentDirectory(path) {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}
