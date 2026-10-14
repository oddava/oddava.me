// Clones every key from one Upstash-REST-compatible Redis into another — the
// one-time move from Upstash to the self-hosted store in `deploy/vps/`.
//
// Keys are copied raw, namespace prefixes included, so the clone is addressed
// exactly like the source. Both ends speak the REST protocol the Worker uses,
// so this needs no TCP access to either store.
//
//   SOURCE_REDIS_REST_URL / SOURCE_REDIS_REST_TOKEN   e.g. the Upstash database
//   TARGET_REDIS_REST_URL / TARGET_REDIS_REST_TOKEN   e.g. https://redis.<domain>
//
// Refuses a non-empty target unless `--overwrite`, which re-copies every source
// key but leaves target-only keys alone.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertKnownArgs, loadEnvironment } from './lib/redis-content.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
assertKnownArgs(arguments_, ['--overwrite']);
const overwrite = arguments_.includes('--overwrite');

const CHUNK = 500;

function endpoint(environment, side) {
  const url = environment[`${side}_REDIS_REST_URL`];
  const token = environment[`${side}_REDIS_REST_TOKEN`];
  if (!url || !token) {
    throw new Error(
      `Missing ${side}_REDIS_REST_URL and ${side}_REDIS_REST_TOKEN.`,
    );
  }
  return {
    url,
    async command(command) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command.map(String)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        throw new Error(
          `${side} ${command[0]} failed: ${response.status} ${payload.error ?? 'Unknown error'}`,
        );
      }
      return payload.result;
    },
  };
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function copyKey(source, target, key) {
  const type = await source.command(['TYPE', key]);
  if (type === 'none') return false; // expired between SCAN and now

  switch (type) {
    case 'string': {
      const value = await source.command(['GET', key]);
      if (value === null) return false;
      await target.command(['SET', key, value]);
      break;
    }
    case 'set': {
      const members = await source.command(['SMEMBERS', key]);
      await target.command(['DEL', key]);
      for (const part of chunks(members, CHUNK)) {
        await target.command(['SADD', key, ...part]);
      }
      break;
    }
    case 'list': {
      const items = await source.command(['LRANGE', key, 0, -1]);
      await target.command(['DEL', key]);
      for (const part of chunks(items, CHUNK)) {
        await target.command(['RPUSH', key, ...part]);
      }
      break;
    }
    case 'hash': {
      const flat = await source.command(['HGETALL', key]);
      await target.command(['DEL', key]);
      for (const part of chunks(flat, CHUNK * 2)) {
        await target.command(['HSET', key, ...part]);
      }
      break;
    }
    case 'zset': {
      const flat = await source.command(['ZRANGE', key, 0, -1, 'WITHSCORES']);
      await target.command(['DEL', key]);
      for (const part of chunks(flat, CHUNK * 2)) {
        const pairs = [];
        for (let index = 0; index < part.length; index += 2) {
          pairs.push(part[index + 1], part[index]);
        }
        await target.command(['ZADD', key, ...pairs]);
      }
      break;
    }
    default:
      throw new Error(`Unsupported type "${type}" for key ${key}.`);
  }

  const ttl = await source.command(['PTTL', key]);
  if (Number(ttl) > 0) await target.command(['PEXPIRE', key, ttl]);
  return true;
}

const environment = loadEnvironment(projectRoot);
const source = endpoint(environment, 'SOURCE');
const target = endpoint(environment, 'TARGET');

if (source.url === target.url) {
  throw new Error('Source and target are the same store.');
}

const existing = Number(await target.command(['DBSIZE']));
if (existing > 0 && !overwrite) {
  throw new Error(
    `Target already holds ${existing} keys. Re-run with --overwrite to copy over them.`,
  );
}

let cursor = '0';
let copied = 0;
do {
  const [next, keys] = await source.command(['SCAN', cursor, 'COUNT', CHUNK]);
  cursor = String(next);
  for (const key of keys) {
    if (await copyKey(source, target, key)) copied += 1;
  }
  process.stdout.write(`\rcopied ${copied} keys`);
} while (cursor !== '0');

const [sourceSize, targetSize] = await Promise.all([
  source.command(['DBSIZE']),
  target.command(['DBSIZE']),
]);
console.log(
  `\ndone. source DBSIZE=${sourceSize} target DBSIZE=${targetSize}` +
    (Number(sourceSize) === Number(targetSize) ? '' : ' (mismatch — check)'),
);
