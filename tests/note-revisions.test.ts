import { describe, expect, it, vi } from 'vitest';
import { handleContentRevisions } from '../src/lib/server/content/revisions-api';
import {
  noteIdFromPath,
  withNoteRevisions,
} from '../src/lib/server/content/revisions-hook';
import {
  createNoteRevisionStore,
  historyKey,
  isRevisionId,
  parseRevision,
  parseRevisionList,
} from '../src/lib/server/content/revisions-store';
import type {
  NoteRevision,
  NoteRevisionStore,
  RevisionCommand,
} from '../src/lib/server/content/revisions-store';
import type {
  ContentProvider,
  ContentSourceFile,
} from '../src/lib/server/content/types';
import { ContentConflictError } from '../src/lib/server/content/types';

const NOTE = 'src/content/notes/diary/hello.md';

function fakeRevisions(
  overrides: Partial<NoteRevisionStore> = {},
): NoteRevisionStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    snapshot: vi.fn(async (input) => {
      calls.push(`snapshot:${input.id}`);
      return 'recorded' as const;
    }),
    list: vi.fn(async () => []),
    read: vi.fn(async () => null),
    rename: vi.fn(async (from, to) => {
      calls.push(`rename:${from}->${to}`);
    }),
    drop: vi.fn(async (id) => {
      calls.push(`drop:${id}`);
    }),
    ...overrides,
  };
}

function fakeStore(calls: string[]) {
  return {
    async writeTextFile(path: string) {
      calls.push(`write:${path}`);
      return { message: 'ok', revision: 'next' };
    },
    async moveFile() {
      calls.push('move');
      return { message: 'ok', revision: 'next' };
    },
    async moveDirectory() {
      calls.push('moveDirectory');
      return { message: 'ok' };
    },
    async deleteFile() {
      calls.push('delete');
      return { message: 'ok' };
    },
    async deleteDirectory() {
      calls.push('deleteDirectory');
      return { message: 'ok' };
    },
    async moveArchivedNote() {
      calls.push('moveArchived');
      return { message: 'ok', revision: 'next' };
    },
    async readFile() {
      return null;
    },
  } as unknown as ContentProvider;
}

describe('noteIdFromPath', () => {
  it('names notes by id and ignores everything else', () => {
    expect(noteIdFromPath(NOTE)).toBe('hello');
    expect(noteIdFromPath('src/content/notes/index.md')).toBe('index');
    expect(noteIdFromPath('public/images/notes/hello.md')).toBeNull();
    expect(noteIdFromPath('src/content/notes/diary/photo.png')).toBeNull();
  });
});

describe('withNoteRevisions', () => {
  it('records the note being replaced before an update lands', async () => {
    const revisions = fakeRevisions();
    const store = withNoteRevisions(fakeStore(revisions.calls), revisions);

    await store.writeTextFile(NOTE, 'body', 'msg', 'r1');

    expect(revisions.calls).toEqual(['snapshot:hello', `write:${NOTE}`]);
    expect(revisions.snapshot).toHaveBeenCalledWith({
      id: 'hello',
      filePath: NOTE,
      expectedRevision: 'r1',
    });
  });

  it('records nothing for a create, a non-note path, or a media write', async () => {
    const revisions = fakeRevisions();
    const store = withNoteRevisions(fakeStore(revisions.calls), revisions);

    await store.writeTextFile(NOTE, 'body', 'msg');
    await store.writeTextFile('public/images/notes/a.md', 'x', 'msg', 'r1');

    expect(revisions.snapshot).not.toHaveBeenCalled();
  });

  it('still saves when history is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const revisions = fakeRevisions({
      snapshot: vi.fn(async () => {
        throw new Error('redis down');
      }),
    });
    const store = withNoteRevisions(fakeStore(revisions.calls), revisions);

    await expect(
      store.writeTextFile(NOTE, 'body', 'msg', 'r1'),
    ).resolves.toMatchObject({ revision: 'next' });
    expect(revisions.calls).toEqual([`write:${NOTE}`]);
  });

  it('does not touch history when a write is refused', async () => {
    const revisions = fakeRevisions();
    const inner = fakeStore(revisions.calls);
    inner.moveFile = async () => {
      throw new ContentConflictError('revision_conflict');
    };
    const store = withNoteRevisions(inner, revisions);

    await expect(
      store.moveFile(NOTE, 'src/content/notes/diary/renamed.md', 'm', 'r1'),
    ).rejects.toThrow();
    expect(revisions.rename).not.toHaveBeenCalled();
  });

  it('carries history to a renamed note but not to one moved between folders', async () => {
    const revisions = fakeRevisions();
    const store = withNoteRevisions(fakeStore(revisions.calls), revisions);

    await store.moveFile(NOTE, 'src/content/notes/other/hello.md', 'm', 'r1');
    await store.moveFile(NOTE, 'src/content/notes/diary/bye.md', 'm', 'r1');

    expect(revisions.rename).toHaveBeenCalledWith('hello', 'hello');
    expect(revisions.rename).toHaveBeenCalledWith('hello', 'bye');
  });

  it("follows a folder page's rename and a permanent delete", async () => {
    const revisions = fakeRevisions();
    const store = withNoteRevisions(fakeStore(revisions.calls), revisions);

    await store.moveDirectory(
      'src/content/notes/reading',
      'src/content/notes/books',
      'm',
      {
        from: 'src/content/notes/reading.md',
        to: 'src/content/notes/books.md',
        revision: 'r1',
      },
    );
    await store.deleteFile(NOTE, 'm', 'r1');
    await store.deleteDirectory('src/content/notes/books', 'm', {
      path: 'src/content/notes/books.md',
      revision: 'r2',
    });

    expect(revisions.calls).toEqual([
      'moveDirectory',
      'rename:reading->books',
      'delete',
      'drop:hello',
      'deleteDirectory',
      'drop:books',
    ]);
  });

  it("carries history across the notes API's archive rename", async () => {
    const revisions = fakeRevisions();
    const store = withNoteRevisions(
      fakeStore(revisions.calls),
      revisions,
    ) as ContentProvider & {
      moveArchivedNote: (input: unknown) => Promise<unknown>;
    };

    await store.moveArchivedNote({
      fromStorePath: NOTE,
      toStorePath: 'src/content/notes/diary/goodbye.md',
    });

    expect(revisions.calls).toEqual(['moveArchived', 'rename:hello->goodbye']);
  });

  it('keeps the methods of a class-based store', async () => {
    class Store {
      readonly files = ['a'];
      async listFilePaths() {
        return this.files;
      }
    }
    const store = withNoteRevisions(
      new Store() as unknown as ContentProvider,
      fakeRevisions(),
    );
    await expect(store.listFilePaths('x')).resolves.toEqual(['a']);
  });
});

describe('revision parsing', () => {
  it('reads the list the script returns, tolerating an empty one', () => {
    expect(parseRevisionList('{}')).toEqual([]);
    expect(
      parseRevisionList(
        JSON.stringify([
          {
            id: 'a'.repeat(16),
            at: '2026-01-01T00:00:00.000Z',
            rec: 5,
            reason: 'autosave',
            bytes: 10,
          },
          { id: 'broken' },
        ]),
      ),
    ).toEqual([
      {
        id: 'a'.repeat(16),
        at: '2026-01-01T00:00:00.000Z',
        recordedAt: 5,
        reason: 'autosave',
        bytes: 10,
      },
    ]);
  });

  it('reads one stored revision with its content', () => {
    const parsed = parseRevision(
      JSON.stringify({
        id: 'b'.repeat(16),
        at: '2026-01-01T00:00:00.000Z',
        rec: 7,
        reason: 'pre-restore',
        content: 'héllo',
      }),
    );
    expect(parsed).toMatchObject({
      reason: 'pre-restore',
      content: 'héllo',
      bytes: 6,
    });
    expect(parseRevision('not json')).toBeNull();
    expect(parseRevision(null)).toBeNull();
  });

  it('only accepts ids this store mints', () => {
    expect(isRevisionId('0123456789abcdef')).toBe(true);
    expect(isRevisionId('../../etc')).toBe(false);
    expect(isRevisionId('')).toBe(false);
  });
});

describe('createNoteRevisionStore', () => {
  it('sends the declared keys to one atomic script', async () => {
    const command = vi.fn(async () => 'recorded');
    const store = createNoteRevisionStore({
      command: command as unknown as RevisionCommand,
      now: () => 1_000,
      newId: () => 'f'.repeat(16),
    });

    await expect(
      store.snapshot({
        id: 'hello',
        filePath: NOTE,
        expectedRevision: 'r1',
        force: true,
        reason: 'pre-restore',
      }),
    ).resolves.toBe('recorded');

    const [call] = command.mock.calls as unknown as Array<
      [Array<string | number>]
    >;
    const args = call![0];
    expect(args[0]).toBe('EVAL');
    expect(args[2]).toBe(2);
    expect(args.slice(3)).toEqual([
      historyKey('hello'),
      `content:file:${NOTE}`,
      'r1',
      1_000,
      5 * 60 * 1000,
      '1',
      30,
      1_500_000,
      'f'.repeat(16),
      'pre-restore',
    ]);
  });

  it('never renames a key onto itself', async () => {
    const command = vi.fn(async () => 1);
    await createNoteRevisionStore({
      command: command as unknown as RevisionCommand,
    }).rename('same', 'same');
    expect(command).not.toHaveBeenCalled();
  });
});

describe('handleContentRevisions', () => {
  const VERSION: NoteRevision = {
    id: 'a'.repeat(16),
    at: '2026-01-01T00:00:00.000Z',
    recordedAt: 1,
    reason: 'autosave',
    bytes: 40,
    content:
      '---\norder: 9\nicon: ⭐\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n# Old title\n\nOld words.\n',
  };

  function file(content: string, revision = 'r5'): ContentSourceFile {
    return {
      path: NOTE,
      content,
      encoding: 'utf8',
      byteLength: content.length,
      updatedAt: '2026-02-01T00:00:00.000Z',
      revision,
    };
  }

  function provider(current: ContentSourceFile | null) {
    const writes: Array<{ path: string; content: string; revision?: string }> =
      [];
    const store = {
      listFilePaths: async () => (current ? [current.path] : []),
      readFile: async () => current,
      writeTextFile: async (
        path: string,
        content: string,
        _message: string,
        revision?: string,
      ) => {
        writes.push({ path, content, revision });
        return { message: 'ok', revision: 'r6' };
      },
    } as unknown as ContentProvider;
    return { store, writes };
  }

  const url = 'https://oddava.me/api/admin/content/notes/hello/history';
  const request = (init?: RequestInit, search = '') =>
    new Request(url + search, init);

  it('lists the kept versions', async () => {
    const { store } = provider(file('# Now'));
    const revisions = fakeRevisions({
      list: vi.fn(async () => [{ ...VERSION }]),
    });

    const response = await handleContentRevisions(
      store,
      'notes',
      'hello',
      request(),
      revisions,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      versions: [expect.objectContaining({ id: VERSION.id })],
    });
  });

  it('previews one version as fields and body', async () => {
    const { store } = provider(file('# Now'));
    const revisions = fakeRevisions({ read: vi.fn(async () => VERSION) });

    const response = await handleContentRevisions(
      store,
      'notes',
      'hello',
      request(undefined, `?version=${VERSION.id}`),
      revisions,
    );

    const { version } = (await response.json()) as {
      version: { body: string; fields: Record<string, unknown> };
    };
    expect(version.body).toBe('# Old title\n\nOld words.\n');
    expect(version.fields.icon).toBe('⭐');
    expect(version).not.toHaveProperty('content');
  });

  it('answers 404 for a note or version that is not there', async () => {
    const missingNote = await handleContentRevisions(
      provider(null).store,
      'notes',
      'hello',
      request(),
      fakeRevisions(),
    );
    expect(missingNote.status).toBe(404);

    const missingVersion = await handleContentRevisions(
      provider(file('# Now')).store,
      'notes',
      'hello',
      request(undefined, '?version=zzzz'),
      fakeRevisions(),
    );
    expect(missingVersion.status).toBe(404);
    expect(await missingVersion.json()).toMatchObject({
      code: 'version_not_found',
    });
  });

  it('restores after recording the current note, keeping its place in the tree', async () => {
    const { store, writes } = provider(
      file('---\norder: 2\nupdated: 2026-02-01T00:00:00.000Z\n---\n\n# Now\n'),
    );
    const revisions = fakeRevisions({ read: vi.fn(async () => VERSION) });

    const response = await handleContentRevisions(
      store,
      'notes',
      'hello',
      request({
        method: 'POST',
        body: JSON.stringify({ versionId: VERSION.id, revision: 'r5' }),
      }),
      revisions,
    );

    expect(response.status).toBe(200);
    expect(revisions.snapshot).toHaveBeenCalledWith({
      id: 'hello',
      filePath: NOTE,
      expectedRevision: 'r5',
      force: true,
      reason: 'pre-restore',
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.revision).toBe('r5');
    expect(writes[0]!.content).toContain('# Old title');
    expect(writes[0]!.content).toContain('order: 2');
    expect(writes[0]!.content).toContain('icon: ⭐');
    expect(writes[0]!.content).not.toContain('order: 9');
    const body = (await response.json()) as {
      entry: { body: string; revision: string };
    };
    expect(body.entry.revision).toBe('r6');
    expect(body.entry.body).toContain('Old words.');
  });

  it('refuses a restore over a note that changed, before touching anything', async () => {
    const { store, writes } = provider(file('# Now', 'r7'));
    const revisions = fakeRevisions({ read: vi.fn(async () => VERSION) });

    const response = await handleContentRevisions(
      store,
      'notes',
      'hello',
      request({
        method: 'POST',
        body: JSON.stringify({ versionId: VERSION.id, revision: 'r5' }),
      }),
      revisions,
    );

    expect(response.status).toBe(409);
    expect(revisions.snapshot).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('overwrites nothing when the undo copy cannot be made', async () => {
    const { store, writes } = provider(file('# Now'));
    const revisions = fakeRevisions({
      read: vi.fn(async () => VERSION),
      snapshot: vi.fn(async () => {
        throw new Error('redis down');
      }),
    });

    await expect(
      handleContentRevisions(
        store,
        'notes',
        'hello',
        request({
          method: 'POST',
          body: JSON.stringify({ versionId: VERSION.id, revision: 'r5' }),
        }),
        revisions,
      ),
    ).rejects.toThrow('redis down');
    expect(writes).toHaveLength(0);
  });

  for (const outcome of ['skipped', 'throttled'] as const) {
    it(`overwrites nothing when the undo copy is ${outcome}`, async () => {
      const { store, writes } = provider(file('# Now'));
      const revisions = fakeRevisions({
        read: vi.fn(async () => VERSION),
        snapshot: vi.fn(async () => outcome),
      });

      const response = await handleContentRevisions(
        store,
        'notes',
        'hello',
        request({
          method: 'POST',
          body: JSON.stringify({ versionId: VERSION.id, revision: 'r5' }),
        }),
        revisions,
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'restore_backup_failed',
        error: expect.stringContaining('Nothing was changed'),
      });
      expect(writes).toHaveLength(0);
    });
  }

  it('restores when the current note is already the newest version', async () => {
    const { store, writes } = provider(file('# Now'));
    const revisions = fakeRevisions({
      read: vi.fn(async () => VERSION),
      snapshot: vi.fn(async () => 'unchanged' as const),
    });

    const response = await handleContentRevisions(
      store,
      'notes',
      'hello',
      request({
        method: 'POST',
        body: JSON.stringify({ versionId: VERSION.id, revision: 'r5' }),
      }),
      revisions,
    );

    expect(response.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  describe('keeps the current draft state', () => {
    async function restore(currentContent: string, versionContent: string) {
      const { store, writes } = provider(file(currentContent));
      const revisions = fakeRevisions({
        read: vi.fn(async () => ({ ...VERSION, content: versionContent })),
      });
      const response = await handleContentRevisions(
        store,
        'notes',
        'hello',
        request({
          method: 'POST',
          body: JSON.stringify({ versionId: VERSION.id, revision: 'r5' }),
        }),
        revisions,
      );
      expect(response.status).toBe(200);
      expect(writes).toHaveLength(1);
      return {
        written: writes[0]!.content,
        body: (await response.json()) as {
          fields: Record<string, unknown>;
          entry: { draft?: boolean; fields: Record<string, unknown> };
        },
      };
    }

    it('does not publish a draft by restoring a pre-draft version', async () => {
      const { written, body } = await restore(
        '---\ndraft: true\n---\n\n# Draft now\n',
        '# Written before drafts existed\n',
      );
      expect(written).toContain('draft: true');
      expect(written).toContain('# Written before drafts existed');
      expect(body.fields.draft).toBe(true);
      expect(body.entry.draft).toBe(true);
    });

    it('does not publish a draft by restoring a published version', async () => {
      const { written, body } = await restore(
        '---\ndraft: true\n---\n\n# Draft now\n',
        '---\norder: 3\n---\n\n# Was published\n',
      );
      expect(written).toContain('draft: true');
      expect(body.fields.draft).toBe(true);
    });

    it('does not hide a live note by restoring an old draft version', async () => {
      const { written, body } = await restore(
        '# Live now\n',
        '---\ndraft: true\n---\n\n# Back when it was a draft\n',
      );
      expect(written).not.toContain('draft:');
      expect(written).toContain('# Back when it was a draft');
      expect(body.fields).not.toHaveProperty('draft');
      expect(body.entry).not.toHaveProperty('draft');
    });
  });

  it('requires the current revision to restore', async () => {
    const response = await handleContentRevisions(
      provider(file('# Now')).store,
      'notes',
      'hello',
      request({
        method: 'POST',
        body: JSON.stringify({ versionId: VERSION.id }),
      }),
      fakeRevisions(),
    );
    expect(response.status).toBe(400);
  });
});
