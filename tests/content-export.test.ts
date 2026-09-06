import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const rootNote = 'src/content/notes/index.md';
const oldNote = 'src/content/notes/old.md';
let fixture: string;

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'oddava-export-'));
  await mkdir(join(fixture, 'scripts/lib'), { recursive: true });
  await mkdir(join(fixture, 'src/content/notes'), { recursive: true });
  for (const path of [
    'scripts/export-notes-from-redis.mjs',
    'scripts/lib/redis-content.mjs',
  ]) {
    await copyFile(new URL(`../${path}`, import.meta.url), join(fixture, path));
  }
  await writeFile(join(fixture, rootNote), '# Original root\n');
  await writeFile(join(fixture, oldNote), '# Precious backup\n');
});
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

function record(content: string, enc = 'utf8') {
  return JSON.stringify({ content, enc });
}

async function runExport(
  records: Record<string, string | null>,
  flags: string[] = [],
  truncate = false,
) {
  // Run the actual CLI against a local REST fixture. This exercises validation
  // ordering, real filesystem writes, pruning, and exit status together.
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const [command, ...args] = JSON.parse(body) as string[];
    let result: unknown;
    if (command === 'SET') result = 'OK';
    else if (command === 'EVAL') result = 1;
    else if (command === 'SMEMBERS') result = Object.keys(records);
    else if (command === 'MGET')
      result = truncate
        ? []
        : args.map((key) => records[key.slice('content:file:'.length)] ?? null);
    else throw new Error(`Unexpected command: ${command}`);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test port');
  try {
    return await execute(
      process.execPath,
      [
        join(fixture, 'scripts/export-notes-from-redis.mjs'),
        '--target=prod',
        ...flags,
      ],
      {
        env: {
          PATH: process.env.PATH,
          UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${address.port}`,
          UPSTASH_REDIS_REST_TOKEN: 'fixture-token',
        },
        timeout: 10_000,
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function expectBackupUnchanged() {
  expect(await readFile(join(fixture, rootNote), 'utf8')).toBe(
    '# Original root\n',
  );
  expect(await readFile(join(fixture, oldNote), 'utf8')).toBe(
    '# Precious backup\n',
  );
}

describe('content export safety', () => {
  it('refuses a missing record before overwriting or pruning any backup', async () => {
    await expect(
      runExport({ [rootNote]: record('# New root'), [oldNote]: null }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Missing content record'),
    });
    await expectBackupUnchanged();
  });

  it.each(['not json', 'null', record('not-base64!', 'base64')])(
    'refuses corrupt records before changing files (%s)',
    async (invalid) => {
      await expect(
        runExport({
          [rootNote]: record('# New root'),
          'src/content/notes/z.md': invalid,
        }),
      ).rejects.toBeDefined();
      await expectBackupUnchanged();
    },
  );

  it('refuses an empty store instead of deleting the backup', async () => {
    await expect(runExport({})).rejects.toMatchObject({
      stderr: expect.stringContaining('no root index note'),
    });
    await expectBackupUnchanged();
  });

  it('refuses incomplete MGET results', async () => {
    await expect(
      runExport({ [rootNote]: record('# New root') }, [], true),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('incomplete content snapshot'),
    });
    await expectBackupUnchanged();
  });

  it('exports notes and binary media and prunes genuinely removed notes', async () => {
    const media = 'public/images/notes/cover.png';
    const bytes = Buffer.from([0, 1, 2, 255]);
    await runExport({
      [rootNote]: record('# New root'),
      [media]: record(bytes.toString('base64'), 'base64'),
    });
    expect(await readFile(join(fixture, rootNote), 'utf8')).toBe('# New root');
    expect(await readFile(join(fixture, media))).toEqual(bytes);
    await expect(readFile(join(fixture, oldNote))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps dry runs read-only and honors keep-removed', async () => {
    const records = { [rootNote]: record('# New root') };
    await runExport(records, ['--dry-run']);
    await expectBackupUnchanged();
    await runExport(records, ['--keep-removed']);
    expect(await readFile(join(fixture, rootNote), 'utf8')).toBe('# New root');
    expect(await readFile(join(fixture, oldNote), 'utf8')).toBe(
      '# Precious backup\n',
    );
  });
});
