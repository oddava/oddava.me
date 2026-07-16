import { describe, expect, it } from 'vitest';

import {
  CONTENT_KEYS,
  firstConfiguredSecret as scriptFirstConfiguredSecret,
  LOCK_TTL_MS,
  MUTATION_LOCK_KEY,
  namespaceCommand,
  storageNamespacePrefix,
} from '../scripts/lib/redis-content.mjs';
import { firstConfiguredSecret } from '../src/lib/server/secrets';
import {
  DIRECTORIES_SET,
  FILES_SET,
  fileKey,
  MUTATION_LOCK_KEY as STORE_LOCK_KEY,
  MUTATION_LOCK_TTL_MS,
  VERSION_KEY,
} from '../src/lib/server/content/redis-store';
import { namespaceCommandWith } from '../src/lib/server/core/storage';

/**
 * The app and the sync scripts address the same Redis. The scripts run under
 * bare `node`, so they cannot import the .ts and the primitives are duplicated
 * by necessity. Every duplicate below encodes a contract about live data, and
 * drift in any of them is silent: the two sides simply start talking about
 * different keys, and the symptom is missing notes rather than an error.
 *
 * This file is what that duplication is allowed to cost.
 */

// Every shape the namespacing has to get right: the key positions differ per
// operation, so this is protocol knowledge, not string handling.
const COMMANDS: (string | number)[][] = [
  ['GET', 'content:version'],
  ['SET', 'content:mutation-lock', 'token', 'NX', 'PX', 60_000],
  ['SMEMBERS', 'content:files'],
  // Multi-key on every variadic operation. A single-key case cannot tell the
  // variadic branch from the "namespace argument 1" fallback -- they agree by
  // accident -- so it would pass while the two implementations disagreed.
  ['MGET', 'content:file:a.md', 'content:file:b.md'],
  ['DEL', 'content:file:a.md', 'content:file:b.md'],
  ['UNLINK', 'content:file:a.md', 'content:file:b.md'],
  // Only the declared key count is namespaced; ARGV after it must be untouched.
  ['EVAL', 'return 1', 2, 'content:files', 'content:dirs', 'content:version'],
  ['EVAL', 'return 1', 0, 'content:files'],
  ['EVALSHA', 'abc123', 1, 'content:version', 'content:files'],
  // No key at all.
  ['PING'],
  // A value that looks like a key must not be prefixed.
  ['SET', 'content:version', 'content:files'],
];

describe('key namespacing agrees between the app and the sync scripts', () => {
  it.each(COMMANDS.map((command) => [command[0] as string, command]))(
    'namespaces %s identically',
    (_operation, command) => {
      for (const prefix of ['dev:', '']) {
        expect(namespaceCommand(command, prefix)).toEqual(
          namespaceCommandWith(command, prefix),
        );
      }
    },
  );
});

describe('the namespace prefix for a sync target', () => {
  // The app's rule (getStorageNamespacePrefix) is APP_ENV-only and defaults to
  // development. The scripts add a target, because `--target=prod` writes
  // production data from a machine whose APP_ENV says development.
  it('is empty for the prod target, whatever the local APP_ENV says', () => {
    expect(storageNamespacePrefix('prod', {})).toBe('');
    expect(storageNamespacePrefix('prod', { APP_ENV: 'development' })).toBe('');
  });

  it('mirrors the app for a local target', () => {
    expect(storageNamespacePrefix('local', { APP_ENV: 'production' })).toBe('');
    expect(storageNamespacePrefix('local', { APP_ENV: 'development' })).toBe(
      'dev:',
    );
  });

  it('defaults a local target to dev, exactly as the app does', () => {
    // The regression this replaces: the scripts fell back to NODE_ENV when
    // APP_ENV was unset, which the app never does. Under NODE_ENV=production
    // they wrote un-prefixed keys that a dev server reading `dev:` could not
    // see -- a migration that appeared to succeed and imported nothing.
    expect(storageNamespacePrefix('local', {})).toBe('dev:');
    expect(storageNamespacePrefix('local', { NODE_ENV: 'production' })).toBe(
      'dev:',
    );
  });
});

describe('content key layout agrees between the app and the sync scripts', () => {
  it('names the same sets and keys', () => {
    expect(CONTENT_KEYS.files).toBe(FILES_SET);
    expect(CONTENT_KEYS.directories).toBe(DIRECTORIES_SET);
    expect(CONTENT_KEYS.version).toBe(VERSION_KEY);
  });

  it('derives the same per-file key', () => {
    for (const path of [
      'src/content/notes/index.md',
      'src/content/notes/reading/books.mdx',
    ]) {
      expect(CONTENT_KEYS.file(path)).toBe(fileKey(path));
    }
  });

  it('contends for the same lock on the same terms', () => {
    expect(MUTATION_LOCK_KEY).toBe(STORE_LOCK_KEY);
    expect(LOCK_TTL_MS).toBe(MUTATION_LOCK_TTL_MS);
  });
});

describe('what counts as a configured secret agrees', () => {
  // The vite dev proxies used to hold a third copy of this. They import the .ts
  // now -- they run inside vite, so they can. The scripts cannot, so this is
  // what keeps the last copy honest.
  const CASES: (string | undefined)[][] = [
    ['real-secret-value'],
    ['  padded-secret  '],
    [undefined],
    [''],
    ['   '],
    // Every placeholder shape an example file produces. Accepting one of these
    // as live is the failure this rule exists to prevent.
    ['change-me'],
    ['CHANGEME'],
    ['replace-me'],
    ['replace_me'],
    ['your_token_goes'],
    ['YOUR_secret'],
    ['token_here'],
    ['SOMETHING_HERE'],
    // Order matters: the first configured value wins, placeholders skipped.
    ['change-me', 'actual-value'],
    [undefined, '', 'your_key', 'actual-value'],
    ['first', 'second'],
    // Not placeholders, despite looking close.
    ['here_we_go'],
    ['not-your-problem'],
  ];

  it.each(CASES.map((values) => [JSON.stringify(values), values]))(
    'agrees on %s',
    (_label, values) => {
      expect(scriptFirstConfiguredSecret(...values)).toBe(
        firstConfiguredSecret(...values),
      );
    },
  );
});
