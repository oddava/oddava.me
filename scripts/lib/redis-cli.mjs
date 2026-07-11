// Minimal Redis transport shared by the notes migrate/export scripts.
//
// It talks to the SAME store the app reads at runtime, applying the identical
// key namespacing so seeded data lines up with `src/lib/server/content`:
//   - local target  -> node `redis` client, keys prefixed `dev:`
//     (mirrors getStorageNamespacePrefix() in development)
//   - prod target    -> Upstash REST, no prefix
//
// Only single-key commands are used, and (like the app's namespacing) the
// prefix is applied to argv[1] — the key — so members/values stay verbatim.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadEnvFile(projectRoot) {
  const env = { ...process.env };
  try {
    const raw = readFileSync(join(projectRoot, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in env)) env[key] = value;
    }
  } catch {
    /* no .env file — rely on process.env */
  }
  return env;
}

export function resolveTarget(env, explicit) {
  if (explicit) return explicit;
  const mode = env.REDIS_MODE ?? env.APP_ENV;
  return mode === 'upstash' || mode === 'production' ? 'prod' : 'local';
}

export async function createTransport(target, env) {
  // Mirror the app's namespacing (getStorageNamespacePrefix): only the local
  // Redis path is namespaced, and only in a development environment. The
  // Upstash/prod path stores keys verbatim.
  const isDevEnv =
    env.APP_ENV !== 'production' && env.NODE_ENV !== 'production';
  const prefix = target === 'local' && isDevEnv ? 'dev:' : '';

  const applyPrefix = (command) => {
    const parts = command.map((part) => String(part));
    if (prefix && parts[1] !== undefined) parts[1] = `${prefix}${parts[1]}`;
    return parts;
  };

  if (target === 'local') {
    const url = env.LOCAL_REDIS_URL ?? 'redis://127.0.0.1:6379';
    const { createClient } = await import('redis');
    const client = createClient({
      url,
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    });
    await client.connect();
    return {
      target,
      prefix,
      async command(cmd) {
        return client.sendCommand(applyPrefix(cmd));
      },
      async close() {
        await client.quit();
      },
    };
  }

  const url =
    env.UPSTASH_REDIS_REST_URL ?? env.UPSTASH_REDIS_REST_KV_REST_API_URL;
  const token =
    env.UPSTASH_REDIS_REST_TOKEN ?? env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      'Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN for the prod target.',
    );
  }
  return {
    target,
    prefix,
    async command(cmd) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(applyPrefix(cmd)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        throw new Error(
          `Redis command failed (${response.status}): ${payload.error ?? 'unknown'}`,
        );
      }
      return payload.result;
    },
    async close() {},
  };
}

// The virtual-filesystem key layout, kept in lockstep with redis-store.ts.
export const KEYS = {
  files: 'content:files',
  dirs: 'content:dirs',
  version: 'content:version',
  file: (path) => `content:file:${path}`,
};

export function ancestorsOfDir(dir) {
  const parts = dir.split('/').filter(Boolean);
  const out = [];
  for (let i = parts.length; i > 0; i -= 1)
    out.push(parts.slice(0, i).join('/'));
  return out;
}

export function parentDir(path) {
  const segments = path.split('/');
  segments.pop();
  return segments.join('/');
}
