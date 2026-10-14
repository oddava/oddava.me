import { describe, expect, it } from 'vitest';
import {
  fileKey,
  readRedisNoteFiles,
  type RedisCommand,
} from '../src/lib/server/content/redis-store';

function storedRecord(content: string, enc: 'utf8' | 'base64' = 'utf8') {
  return JSON.stringify({
    content,
    enc,
    rev: 'r1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
}

function fakeStore(records: Record<string, string>): RedisCommand {
  const command = async (args: Array<string | number>) => {
    const [operation, ...rest] = args.map(String);
    if (operation === 'SMEMBERS') return Object.keys(records);
    if (operation === 'MGET') {
      return rest.map(
        (key) =>
          Object.entries(records).find(
            ([path]) => fileKey(path) === key,
          )?.[1] ?? null,
      );
    }
    throw new Error(`Unexpected command ${operation}`);
  };
  return command as RedisCommand;
}

describe('readRedisNoteFiles', () => {
  it('reads canonical .md and legacy .mdx notes, and nothing else', async () => {
    const files = await readRedisNoteFiles(
      fakeStore({
        'src/content/notes/index.mdx': storedRecord('# notes'),
        'src/content/notes/reading.md': storedRecord('# reading'),
        'src/content/notes/reading/books.mdx': storedRecord('# books'),
        'src/content/notes/draft.txt': storedRecord('not a note'),
        'public/images/notes/cover.png': storedRecord('iVBO', 'base64'),
      }),
    );

    expect(files.map((file) => file.sourceId).toSorted()).toEqual([
      'index',
      'reading',
      'reading/books',
    ]);
    expect(files.find((file) => file.sourceId === 'reading')).toEqual({
      sourceId: 'reading',
      content: '# reading',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });
});
