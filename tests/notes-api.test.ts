import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEntries } from '../src/lib/server/content/documents';
import { decidePublicNote } from '../src/lib/garden/retired';
import {
  NoteArchiveError,
  retargetRedirects,
} from '../src/lib/server/content/note-archive';
import type {
  NotesStore,
  StoredTombstone,
} from '../src/lib/server/content/note-archive';
import {
  handleCreateNote,
  handleDeleteNote,
  handleListNotes,
  handleMoveNote,
  handleReadNote,
  handleRestoreNote,
  handleUpdateNote,
  MAX_NOTES_API_BYTES,
} from '../src/lib/server/content/notes-api';
import { matchesExtension } from '../src/lib/server/content/paths';
import { NOTES_COLLECTION } from '../src/lib/server/content/registry';
import { parseContentDocument } from '../src/lib/server/content/serializers';
import {
  ContentConflictError,
  ContentNotFoundError,
} from '../src/lib/server/content/types';
import type {
  ContentSourceFile,
  ContentWriteResult,
} from '../src/lib/server/content/types';

const TOKEN = 'notes-sync-token';
const ADMIN_TOKEN = 'admin-panel-token';
const SIGNING_SECRET = 'test-signing-secret-with-enough-entropy';
const ORIGIN = 'https://oddava.me';

class MemoryContentProvider {
  readonly files = new Map<string, ContentSourceFile>();
  readonly redirects = new Map<string, string>();
  readonly tombstones = new Map<string, StoredTombstone>();
  writes = 0;
  private revision = 0;

  private nextFile(path: string, content: string): ContentSourceFile {
    this.revision += 1;
    return {
      path,
      content,
      encoding: 'utf8',
      byteLength: Buffer.byteLength(content),
      updatedAt: new Date(2026, 0, this.revision).toISOString(),
      revision: `r${this.revision}`,
    };
  }

  async listFiles(directory: string, extension?: string | readonly string[]) {
    const prefix = `${directory}/`;
    return [...this.files.values()].filter(
      (file) =>
        file.path.startsWith(prefix) && matchesExtension(file.path, extension),
    );
  }

  async readFile(path: string) {
    return this.files.get(path) ?? null;
  }

  async listRedirects() {
    return new Map(this.redirects);
  }

  async readTombstone(publicPath: string) {
    return this.tombstones.get(publicPath) ?? null;
  }

  async listTombstones() {
    return [...this.tombstones].map(([publicPath, tombstone]) => ({
      publicPath,
      tombstone,
    }));
  }

  async moveArchivedNote(input: {
    fromStorePath: string;
    toStorePath: string;
    fromPublic: string;
    toPublic: string;
    revision: string;
    message: string;
  }): Promise<ContentWriteResult> {
    const current = this.files.get(input.fromStorePath);
    if (!current) {
      if (this.tombstones.has(input.fromPublic))
        throw new NoteArchiveError('gone');
      throw new ContentNotFoundError();
    }
    if (current.revision !== input.revision) {
      throw new ContentConflictError('revision_conflict');
    }
    if (this.tombstones.has(input.toPublic))
      throw new NoteArchiveError('deleted');
    if (this.files.has(input.toStorePath)) {
      throw new ContentConflictError('path_exists');
    }
    const moved = this.nextFile(input.toStorePath, current.content);
    this.files.delete(input.fromStorePath);
    this.files.set(input.toStorePath, moved);
    const redirects = retargetRedirects(
      this.redirects,
      input.fromPublic,
      input.toPublic,
    );
    this.redirects.clear();
    for (const [from, to] of redirects) this.redirects.set(from, to);
    return { message: input.message, revision: moved.revision };
  }

  async softDeleteNote(input: {
    storePath: string;
    publicPath: string;
    revision: string;
    message: string;
  }): Promise<StoredTombstone> {
    const current = this.files.get(input.storePath);
    if (!current) {
      if (this.tombstones.has(input.publicPath))
        throw new NoteArchiveError('gone');
      throw new ContentNotFoundError();
    }
    if (current.revision !== input.revision) {
      throw new ContentConflictError('revision_conflict');
    }
    this.revision += 1;
    const tombstone: StoredTombstone = {
      content: current.content,
      enc: 'utf8',
      rev: `r${this.revision}`,
      createdAt: current.updatedAt,
      updatedAt: current.updatedAt,
      deletedAt: '2026-10-30T00:00:00.000Z',
    };
    this.tombstones.set(input.publicPath, tombstone);
    this.redirects.delete(input.publicPath);
    this.files.delete(input.storePath);
    void input.message;
    return tombstone;
  }

  async restoreArchivedNote(input: {
    storePath: string;
    publicPath: string;
    revision: string | undefined;
    record: string;
    message: string;
  }): Promise<ContentWriteResult> {
    const tombstone = this.tombstones.get(input.publicPath);
    if (!tombstone) throw new ContentNotFoundError();
    if (input.revision && tombstone.rev !== input.revision) {
      throw new ContentConflictError('revision_conflict');
    }
    if (this.files.has(input.storePath)) {
      throw new ContentConflictError('path_exists');
    }
    const record = JSON.parse(input.record) as { content?: string };
    const file = this.nextFile(
      input.storePath,
      typeof record.content === 'string' ? record.content : tombstone.content,
    );
    this.files.set(input.storePath, file);
    this.tombstones.delete(input.publicPath);
    this.redirects.delete(input.publicPath);
    return { message: input.message, revision: file.revision };
  }

  async writeTextFile(
    path: string,
    content: string,
    message: string,
    revision?: string,
  ): Promise<ContentWriteResult> {
    this.writes += 1;
    const current = this.files.get(path);
    if (revision) {
      if (!current) throw new ContentNotFoundError();
      if (current.revision !== revision) {
        throw new ContentConflictError('revision_conflict');
      }
    } else if (current) {
      throw new ContentConflictError('path_exists');
    }
    const file = this.nextFile(path, content);
    this.files.set(path, file);
    return { message, revision: file.revision };
  }

  asProvider(): NotesStore {
    return this as unknown as NotesStore;
  }
}

function request(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] =
      'application/json';
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

async function bodyOf(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function fieldsOf(content: string) {
  return parseContentDocument(content).fields;
}

describe('notes API writes', () => {
  it('creates, lists, and fetches a note', async () => {
    const provider = new MemoryContentProvider();
    const created = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content: '# hello\n\nstill learning.',
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = await bodyOf(created);
    const note = createdBody.note as Record<string, unknown>;
    expect(note.path).toBe('diary/hello.md');
    expect(note.title).toBe('hello');
    expect(note.revision).toEqual(expect.any(String));
    expect(note.updated).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(note.content).toEqual(expect.stringContaining('# hello'));
    expect(fieldsOf(String(note.content)).updated).toBe(note.updated);
    expect(fieldsOf(String(note.content)).order).toBe(0);

    const listed = await handleListNotes(provider.asProvider());
    expect(listed.status).toBe(200);
    const listedBody = await bodyOf(listed);
    expect(listedBody.notes).toEqual([
      {
        path: 'diary/hello.md',
        title: 'hello',
        updated: note.updated,
        revision: note.revision,
      },
    ]);

    const fetched = await handleReadNote(
      provider.asProvider(),
      'diary/hello.md',
    );
    expect(fetched.status).toBe(200);
    const fetchedBody = await bodyOf(fetched);
    expect(fetchedBody.note).toMatchObject({
      path: 'diary/hello.md',
      content: note.content,
      revision: note.revision,
    });
  });

  it('accepts a path with or without the collection prefix and extension', async () => {
    const provider = new MemoryContentProvider();
    const created = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'src/content/notes/reading/atomic-habits',
        content: '# atomic habits\n',
      }),
    );
    expect(created.status).toBe(201);
    const fetched = await handleReadNote(
      provider.asProvider(),
      'reading/atomic-habits.md',
    );
    expect(fetched.status).toBe(200);
    expect((await bodyOf(fetched)).note).toMatchObject({
      path: 'reading/atomic-habits.md',
      title: 'atomic habits',
    });
  });

  it('gives the next order in the folder and keeps it when an update omits order', async () => {
    const provider = new MemoryContentProvider();
    await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/first.md',
        content: '# first\n',
      }),
    );
    const second = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/second.md',
        content: '# second\n',
      }),
    );
    const secondNote = (await bodyOf(second)).note as { content: string };
    expect(fieldsOf(secondNote.content).order).toBe(1);

    const updated = await handleUpdateNote(
      provider.asProvider(),
      'diary/second.md',
      request('PUT', `${ORIGIN}/api/notes/diary/second.md`, {
        content: '# second\n\nmore',
      }),
    );
    expect(updated.status).toBe(200);
    const updatedNote = (await bodyOf(updated)).note as { content: string };
    expect(fieldsOf(updatedNote.content).order).toBe(1);
    expect(parseContentDocument(updatedNote.content).body).toContain('more');
  });

  it('replaces a client updated timestamp and drops unknown frontmatter', async () => {
    const provider = new MemoryContentProvider();
    const created = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content:
          '---\nupdated: 2020-01-01T00:00:00.000Z\ntags:\n  - books\n---\n\n# hello\n',
      }),
    );
    const note = (await bodyOf(created)).note as {
      content: string;
      updated: string;
    };
    expect(note.updated).not.toBe('2020-01-01T00:00:00.000Z');
    expect(fieldsOf(note.content).updated).toBe(note.updated);
    expect(fieldsOf(note.content)).not.toHaveProperty('tags');
  });

  it('rejects a second file name that already exists in another folder', async () => {
    const provider = new MemoryContentProvider();
    await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content: '# hello\n',
      }),
    );
    const again = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'reading/hello.md',
        content: '# hello again\n',
      }),
    );
    expect(again.status).toBe(409);
    expect(await bodyOf(again)).toMatchObject({
      code: 'slug_exists',
      note: { path: 'diary/hello.md' },
    });
    expect(provider.writes).toBe(1);
    const entries = await readEntries(provider.asProvider(), NOTES_COLLECTION);
    expect(entries.map((entry) => entry.path)).toEqual([
      'src/content/notes/diary/hello.md',
    ]);
  });

  it('returns the current revision when a create hits an existing path', async () => {
    const provider = new MemoryContentProvider();
    const first = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content: '# hello\n',
      }),
    );
    const revision = ((await bodyOf(first)).note as { revision: string })
      .revision;
    const second = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello',
        content: '# hello\n\nagain',
      }),
    );
    expect(second.status).toBe(409);
    expect(await bodyOf(second)).toMatchObject({
      code: 'path_exists',
      note: { path: 'diary/hello.md', revision },
    });
    expect(provider.writes).toBe(1);
  });

  it('updates when the revision matches and conflicts when it does not', async () => {
    const provider = new MemoryContentProvider();
    const created = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content: '# hello\n',
      }),
    );
    const original = (await bodyOf(created)).note as {
      revision: string;
      content: string;
    };

    const saved = await handleUpdateNote(
      provider.asProvider(),
      'diary/hello.md',
      request('PUT', `${ORIGIN}/api/notes/diary/hello.md`, {
        content: '# hello\n\nfrom the phone',
        revision: original.revision,
      }),
    );
    expect(saved.status).toBe(200);
    const next = (await bodyOf(saved)).note as {
      revision: string;
      content: string;
    };
    expect(next.revision).not.toBe(original.revision);
    expect(next.content).toContain('from the phone');

    const stale = await handleUpdateNote(
      provider.asProvider(),
      'diary/hello.md',
      request('PUT', `${ORIGIN}/api/notes/diary/hello.md`, {
        content: '# hello\n\nstale',
        revision: original.revision,
      }),
    );
    expect(stale.status).toBe(409);
    expect(await bodyOf(stale)).toMatchObject({
      code: 'revision_conflict',
      note: { path: 'diary/hello.md', revision: next.revision },
    });
    const stored = provider.files.get('src/content/notes/diary/hello.md');
    expect(stored?.revision).toBe(next.revision);
    expect(stored?.content).toBe(next.content);
    expect(stored?.content).not.toContain('stale');
  });

  it('overwrites when an update omits the revision', async () => {
    const provider = new MemoryContentProvider();
    await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content: '# hello\n',
      }),
    );
    const updated = await handleUpdateNote(
      provider.asProvider(),
      'diary/hello.md',
      request('PUT', `${ORIGIN}/api/notes/diary/hello.md`, {
        content: '# hello\n\nno version',
      }),
    );
    expect(updated.status).toBe(200);
    expect(
      provider.files.get('src/content/notes/diary/hello.md')?.content,
    ).toContain('no version');
  });

  it('does not create a note on update when the path is missing', async () => {
    const provider = new MemoryContentProvider();
    const response = await handleUpdateNote(
      provider.asProvider(),
      'diary/missing.md',
      request('PUT', `${ORIGIN}/api/notes/diary/missing.md`, {
        content: '# missing\n',
      }),
    );
    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toMatchObject({ code: 'not_found' });
    expect(provider.files.size).toBe(0);
    expect(provider.writes).toBe(0);
  });

  it('rejects paths that are not a note', async () => {
    const provider = new MemoryContentProvider();
    for (const path of [
      '../secret.md',
      'Diary/Hello.md',
      'notes/picture.png',
      'foo//bar.md',
      '',
    ]) {
      const response = await handleCreateNote(
        provider.asProvider(),
        request('POST', `${ORIGIN}/api/notes`, {
          path,
          content: '# no\n',
        }),
      );
      expect(response.status, path).toBe(400);
      expect(await bodyOf(response)).toMatchObject({ code: 'invalid_path' });
    }
    expect(provider.writes).toBe(0);
  });

  it('rejects frontmatter the note schema does not allow', async () => {
    const provider = new MemoryContentProvider();
    const response = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content: '---\nicon: nope\n---\n\n# hello\n',
      }),
    );
    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toMatchObject({
      code: 'validation_failed',
    });
    expect(provider.writes).toBe(0);
  });

  it('rejects a body that is not a note payload', async () => {
    const provider = new MemoryContentProvider();
    const missing = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, { path: 'diary/hello.md' }),
    );
    expect(missing.status).toBe(400);
    expect(await bodyOf(missing)).toMatchObject({ code: 'invalid_content' });

    const created = await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content: '# hello\n',
      }),
    );
    const revision = ((await bodyOf(created)).note as { revision: string })
      .revision;
    const badRevision = await handleUpdateNote(
      provider.asProvider(),
      'diary/hello.md',
      request('PUT', `${ORIGIN}/api/notes/diary/hello.md`, {
        content: '# hello\n',
        revision: 1,
      }),
    );
    expect(badRevision.status).toBe(400);
    expect(await bodyOf(badRevision)).toMatchObject({
      code: 'invalid_revision',
    });
    expect(
      provider.files.get('src/content/notes/diary/hello.md')?.revision,
    ).toBe(revision);

    const invalid = await handleCreateNote(
      provider.asProvider(),
      new Request(`${ORIGIN}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '[]',
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await bodyOf(invalid)).toMatchObject({ code: 'invalid_request' });
  });

  it('lists notes by path without their bodies', async () => {
    const provider = new MemoryContentProvider();
    await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'reading/books.md',
        content: '# books\n',
      }),
    );
    await handleCreateNote(
      provider.asProvider(),
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content: '# hello\n',
      }),
    );
    const listed = await bodyOf(await handleListNotes(provider.asProvider()));
    const notes = listed.notes as Record<string, unknown>[];
    expect(notes.map((note) => note.path)).toEqual([
      'diary/hello.md',
      'reading/books.md',
    ]);
    expect(Object.keys(notes[0]!).toSorted()).toEqual([
      'path',
      'revision',
      'title',
      'updated',
    ]);
    expect(listed.deleted).toEqual([]);
  });

  it('moves a note, collapses rename chains, and keeps a stale revision from writing', async () => {
    const provider = new MemoryContentProvider();
    const store = provider.asProvider();
    const created = await bodyOf(
      await handleCreateNote(
        store,
        request('POST', `${ORIGIN}/api/notes`, {
          path: 'diary/hello.md',
          content: '# hello\n\nstill learning.',
        }),
      ),
    );
    const revision = (created.note as { revision: string }).revision;

    const stale = await handleMoveNote(
      store,
      request('POST', `${ORIGIN}/api/notes/move`, {
        from: 'diary/hello.md',
        to: 'reading/hello.md',
        revision: 'stale',
      }),
    );
    expect(stale.status).toBe(409);
    expect(await bodyOf(stale)).toMatchObject({ code: 'revision_conflict' });
    expect(provider.files.has('src/content/notes/diary/hello.md')).toBe(true);
    expect(provider.redirects.size).toBe(0);

    const moved = await handleMoveNote(
      store,
      request('POST', `${ORIGIN}/api/notes/move`, {
        from: 'diary/hello.md',
        to: 'reading/hello.md',
        revision,
      }),
    );
    expect(moved.status).toBe(200);
    const movedNote = (await bodyOf(moved)).note as {
      path: string;
      revision: string;
      content: string;
    };
    expect(movedNote.path).toBe('reading/hello.md');
    expect(movedNote.content).toContain('still learning');

    const renamed = await handleMoveNote(
      store,
      request('POST', `${ORIGIN}/api/notes/move`, {
        from: 'reading/hello',
        to: 'reading/goodbye.md',
        revision: movedNote.revision,
      }),
    );
    expect(renamed.status).toBe(200);

    expect([...provider.redirects.entries()].toSorted()).toEqual([
      ['diary/hello', 'reading/goodbye'],
      ['reading/hello', 'reading/goodbye'],
    ]);
    const documents = [
      {
        path: 'reading/goodbye',
        sourceId: 'reading/goodbye',
        href: '/notes/reading/goodbye',
      },
    ];
    const retired = {
      redirects: provider.redirects,
      tombstones: new Set<string>(),
    };
    expect(decidePublicNote('diary/hello', documents, retired)).toEqual({
      kind: 'redirect',
      href: '/notes/reading/goodbye',
    });
    expect(decidePublicNote('reading/hello', documents, retired)).toEqual({
      kind: 'redirect',
      href: '/notes/reading/goodbye',
    });

    const old = await handleReadNote(store, 'diary/hello.md');
    expect(old.status).toBe(409);
    expect(await bodyOf(old)).toMatchObject({
      code: 'moved',
      location: 'reading/goodbye.md',
    });

    await handleCreateNote(
      store,
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'projects/taken.md',
        content: '# taken\n',
      }),
    );
    const blocked = await handleMoveNote(
      store,
      request('POST', `${ORIGIN}/api/notes/move`, {
        from: 'reading/goodbye.md',
        to: 'projects/taken.md',
      }),
    );
    expect(blocked.status).toBe(409);
    expect(await bodyOf(blocked)).toMatchObject({ code: 'path_exists' });
    expect(provider.files.has('src/content/notes/reading/goodbye.md')).toBe(
      true,
    );

    const samePath = await handleMoveNote(
      store,
      request('POST', `${ORIGIN}/api/notes/move`, {
        from: 'reading/goodbye.md',
        to: 'reading/goodbye',
      }),
    );
    expect(samePath.status).toBe(400);
    expect(await bodyOf(samePath)).toMatchObject({ code: 'invalid_request' });

    const slug = await handleMoveNote(
      store,
      request('POST', `${ORIGIN}/api/notes/move`, {
        from: 'reading/goodbye.md',
        to: 'diary/taken.md',
      }),
    );
    expect(slug.status).toBe(409);
    expect(await bodyOf(slug)).toMatchObject({ code: 'slug_exists' });

    provider.files.set('src/content/notes/diary/plain.md', {
      path: 'src/content/notes/diary/plain.md',
      content: '# plain\n\nno frontmatter',
      encoding: 'utf8',
      byteLength: Buffer.byteLength('# plain\n\nno frontmatter'),
      updatedAt: '2026-02-02T00:00:00.000Z',
      revision: 'r-plain',
    });
    const plain = await handleMoveNote(
      store,
      request('POST', `${ORIGIN}/api/notes/move`, {
        from: 'diary/plain.md',
        to: 'diary/plain-moved.md',
        revision: 'r-plain',
      }),
    );
    expect(plain.status).toBe(200);
    expect(await bodyOf(plain)).toMatchObject({
      note: { updated: '2026-02-02T00:00:00.000Z' },
    });
  });

  it('soft-deletes a note, hides it from Studio, and restores it', async () => {
    const provider = new MemoryContentProvider();
    const store = provider.asProvider();
    const created = await bodyOf(
      await handleCreateNote(
        store,
        request('POST', `${ORIGIN}/api/notes`, {
          path: 'diary/hello.md',
          content: '# hello\n\nstill learning.',
        }),
      ),
    );
    const revision = (created.note as { revision: string }).revision;

    const stale = await handleDeleteNote(
      store,
      'diary/hello.md',
      request('DELETE', `${ORIGIN}/api/notes/diary/hello.md`, {
        revision: 'stale',
      }),
    );
    expect(stale.status).toBe(409);
    expect(await bodyOf(stale)).toMatchObject({ code: 'revision_conflict' });
    expect(provider.files.has('src/content/notes/diary/hello.md')).toBe(true);

    const deleted = await handleDeleteNote(
      store,
      'diary/hello',
      request('DELETE', `${ORIGIN}/api/notes/diary/hello.md`, { revision }),
    );
    expect(deleted.status).toBe(200);
    const deletedNote = (await bodyOf(deleted)).note as {
      path: string;
      deletedAt: string;
      revision: string;
    };
    expect(deletedNote.path).toBe('diary/hello.md');
    expect(deletedNote.deletedAt).toEqual(expect.any(String));
    expect(provider.files.has('src/content/notes/diary/hello.md')).toBe(false);

    const listed = await bodyOf(await handleListNotes(store));
    expect(listed.notes).toEqual([]);
    expect(listed.deleted).toEqual([
      expect.objectContaining({
        path: 'diary/hello.md',
        title: 'hello',
        deletedAt: deletedNote.deletedAt,
      }),
    ]);
    expect(
      (await readEntries(store, NOTES_COLLECTION)).map((entry) => entry.path),
    ).not.toContain('src/content/notes/diary/hello.md');

    const fetched = await handleReadNote(store, 'diary/hello.md');
    expect(fetched.status).toBe(410);
    expect(await bodyOf(fetched)).toMatchObject({
      code: 'gone',
      note: { content: expect.stringContaining('still learning') },
    });
    const updated = await handleUpdateNote(
      store,
      'diary/hello.md',
      request('PUT', `${ORIGIN}/api/notes/diary/hello.md`, {
        content: '# hello\n\nresurrected by a blind write.',
      }),
    );
    expect(updated.status).toBe(410);
    expect(provider.files.size).toBe(0);

    const recreated = await handleCreateNote(
      store,
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'diary/hello.md',
        content: '# hello\n\nnew note.',
      }),
    );
    expect(recreated.status).toBe(409);
    expect(await bodyOf(recreated)).toMatchObject({ code: 'deleted' });

    const conflicted = await handleRestoreNote(
      store,
      request('POST', `${ORIGIN}/api/notes/restore`, {
        path: 'diary/hello.md',
        revision: 'stale',
      }),
    );
    expect(conflicted.status).toBe(409);
    expect(await bodyOf(conflicted)).toMatchObject({
      code: 'revision_conflict',
    });
    expect(provider.tombstones.has('diary/hello')).toBe(true);

    const restored = await handleRestoreNote(
      store,
      request('POST', `${ORIGIN}/api/notes/restore`, {
        path: 'diary/hello.md',
        revision: deletedNote.revision,
      }),
    );
    expect(restored.status).toBe(200);
    expect(await bodyOf(restored)).toMatchObject({
      note: {
        path: 'diary/hello.md',
        content: expect.stringContaining('still learning'),
      },
    });
    expect(provider.tombstones.size).toBe(0);
    expect((await bodyOf(await handleListNotes(store))).deleted).toEqual([]);
    expect(
      decidePublicNote('diary/hello', [], {
        redirects: new Map(),
        tombstones: new Set(['diary/hello']),
      }).kind,
    ).toBe('gone');
  });

  it('follows a rename into the trash and back out again', async () => {
    const provider = new MemoryContentProvider();
    const store = provider.asProvider();
    const created = await bodyOf(
      await handleCreateNote(
        store,
        request('POST', `${ORIGIN}/api/notes`, {
          path: 'diary/hello.md',
          content: '# hello\n',
        }),
      ),
    );
    const moved = await bodyOf(
      await handleMoveNote(
        store,
        request('POST', `${ORIGIN}/api/notes/move`, {
          from: 'diary/hello.md',
          to: 'reading/hello.md',
          revision: (created.note as { revision: string }).revision,
        }),
      ),
    );
    await handleDeleteNote(
      store,
      'reading/hello.md',
      request('DELETE', `${ORIGIN}/api/notes/reading/hello.md`, {
        revision: (moved.note as { revision: string }).revision,
      }),
    );

    const retired = {
      redirects: await store.listRedirects(),
      tombstones: new Set(
        (await store.listTombstones()).map((entry) => entry.publicPath),
      ),
    };
    expect(decidePublicNote('diary/hello', [], retired).kind).toBe('gone');
    expect(decidePublicNote('reading/hello', [], retired).kind).toBe('gone');
    expect((await handleReadNote(store, 'diary/hello')).status).toBe(410);

    const restored = await handleRestoreNote(
      store,
      request('POST', `${ORIGIN}/api/notes/restore`, {
        path: 'reading/hello.md',
      }),
    );
    expect(restored.status).toBe(200);
    const documents = [
      {
        path: 'reading/hello',
        sourceId: 'reading/hello',
        href: '/notes/reading/hello',
      },
    ];
    expect(
      decidePublicNote('diary/hello', documents, {
        redirects: await store.listRedirects(),
        tombstones: new Set(),
      }),
    ).toEqual({ kind: 'redirect', href: '/notes/reading/hello' });
  });

  it('refuses to delete or rename the root, or a folder page that still has notes', async () => {
    const provider = new MemoryContentProvider();
    const store = provider.asProvider();
    await handleCreateNote(
      store,
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'index.md',
        content: '# notes\n',
      }),
    );
    await handleCreateNote(
      store,
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'reading.md',
        content: '# reading\n',
      }),
    );
    await handleCreateNote(
      store,
      request('POST', `${ORIGIN}/api/notes`, {
        path: 'reading/book.md',
        content: '# book\n',
      }),
    );

    const root = await handleDeleteNote(
      store,
      'index.md',
      request('DELETE', `${ORIGIN}/api/notes/index.md`),
    );
    expect(root.status).toBe(400);
    expect(await bodyOf(root)).toMatchObject({ code: 'root_entry' });

    const renamed = await handleMoveNote(
      store,
      request('POST', `${ORIGIN}/api/notes/move`, {
        from: 'index.md',
        to: 'home.md',
      }),
    );
    expect(renamed.status).toBe(400);
    expect(await bodyOf(renamed)).toMatchObject({ code: 'root_entry' });

    const folder = await handleDeleteNote(
      store,
      'reading.md',
      request('DELETE', `${ORIGIN}/api/notes/reading.md`),
    );
    expect(folder.status).toBe(409);
    expect(await bodyOf(folder)).toMatchObject({ code: 'folder_not_empty' });
    expect(provider.files.has('src/content/notes/reading.md')).toBe(true);
  });
});

const mockContext = (
  method: string,
  path: string,
  options: {
    token?: string | null;
    origin?: string;
    cookie?: string;
    body?: unknown;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  } = {},
) => {
  const headers = new Headers(options.headers);
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.origin) headers.set('Origin', options.origin);
  if (options.body !== undefined)
    headers.set('Content-Type', 'application/json');
  const url = `${ORIGIN}${path}`;
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const httpRequest = new Request(url, init);
  return {
    request: httpRequest,
    cookies: {
      get: (name: string) =>
        name === 'oddava-admin-session' && options.cookie
          ? { value: options.cookie }
          : undefined,
      set: () => undefined,
      delete: () => undefined,
    },
    params: options.params ?? {},
    url: new URL(url),
  } as never;
};

describe('notes API route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  function installStore(options?: {
    configured?: boolean;
    rateLimit?: Response | null;
  }) {
    const provider = new MemoryContentProvider();
    const rateLimit = vi.fn(async () => options?.rateLimit ?? null);
    const lock = vi.fn(async (operation: () => Promise<unknown>) =>
      operation(),
    );
    const readStableContentVersion = vi.fn(async () => '1');
    vi.doMock('../src/lib/server/core/rate-limit', () => ({
      enforceRedisRateLimit: rateLimit,
    }));
    vi.doMock('../src/lib/server/content/redis-store', () => ({
      ContentMutationBusyError: class extends Error {
        readonly code = 'content_busy';
      },
      createRedisContentProvider: () => provider,
      hasContentStore: () => options?.configured ?? true,
      readStableContentVersion,
      withRedisContentMutationLock: lock,
    }));
    return { provider, rateLimit, lock, readStableContentVersion };
  }

  async function loadRoutes() {
    return import('../src/lib/server/content/notes-api-route');
  }

  it('publishes collection and entry handlers, including the methods that answer 405', async () => {
    const collection = await import('../src/pages/api/notes/index');
    const entry = await import('../src/pages/api/notes/[...path]');
    const route = await import('../src/lib/server/content/notes-api-route');
    expect(collection.GET).toBe(route.notesCollectionRoute);
    expect(collection.POST).toBe(route.notesCollectionRoute);
    expect(collection.DELETE).toBe(route.notesCollectionRoute);
    expect(entry.GET).toBe(route.notesEntryRoute);
    expect(entry.PUT).toBe(route.notesEntryRoute);
    expect(entry.DELETE).toBe(route.notesEntryRoute);
    const move = await import('../src/pages/api/notes/move');
    const restore = await import('../src/pages/api/notes/restore');
    expect(move.POST).toBe(route.notesMoveRoute);
    expect(restore.POST).toBe(route.notesRestoreRoute);
  });

  it('is disabled when NOTES_API_TOKEN is unset', async () => {
    vi.stubEnv('NOTES_API_TOKEN', '');
    vi.stubEnv('ADMIN_PANEL_TOKEN', ADMIN_TOKEN);
    const { rateLimit, lock } = installStore();
    const { notesCollectionRoute } = await loadRoutes();

    const response = await notesCollectionRoute(
      mockContext('GET', '/api/notes', { token: ADMIN_TOKEN }),
    );

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toMatchObject({
      code: 'notes_api_disabled',
    });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
  });

  it('is disabled when the token is still the example placeholder', async () => {
    vi.stubEnv('NOTES_API_TOKEN', 'your_notes_api_token');
    const { rateLimit } = installStore();
    const { notesCollectionRoute } = await loadRoutes();

    const response = await notesCollectionRoute(
      mockContext('GET', '/api/notes', { token: 'your_notes_api_token' }),
    );

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toMatchObject({
      code: 'notes_api_disabled',
    });
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it('rejects a missing token, a wrong token, and the admin panel token', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    vi.stubEnv('ADMIN_PANEL_TOKEN', ADMIN_TOKEN);
    const { provider, rateLimit, lock } = installStore();
    const { notesCollectionRoute } = await loadRoutes();

    for (const token of [null, 'not-the-token', ADMIN_TOKEN]) {
      const response = await notesCollectionRoute(
        mockContext('GET', '/api/notes', { token }),
      );
      expect(response.status).toBe(401);
      expect(await bodyOf(response)).toMatchObject({ code: 'unauthorized' });
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer');
    }
    expect(provider.files.size).toBe(0);
    expect(lock).not.toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledTimes(3);
    expect(rateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      'notes-api',
      120,
      60_000,
    );
  });

  it('does not accept an admin session cookie in place of the bearer token', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    vi.stubEnv('ADMIN_PANEL_TOKEN', ADMIN_TOKEN);
    vi.stubEnv('COMMUNITY_SIGNING_SECRET', SIGNING_SECRET);
    const { createAdminSessionValue } =
      await import('../src/lib/server/admin/auth');
    const cookie = await createAdminSessionValue(ADMIN_TOKEN);
    const { lock } = installStore();
    const { notesCollectionRoute } = await loadRoutes();

    const response = await notesCollectionRoute(
      mockContext('GET', '/api/notes', { cookie }),
    );

    expect(response.status).toBe(401);
    expect(lock).not.toHaveBeenCalled();
  });

  it('lists and creates with the bearer token and without a same-origin check', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    const { provider, lock, readStableContentVersion } = installStore();
    const { notesCollectionRoute } = await loadRoutes();

    const created = await notesCollectionRoute(
      mockContext('POST', '/api/notes', {
        token: TOKEN,
        origin: 'https://obsidian.local',
        body: { path: 'diary/hello.md', content: '# hello\n' },
      }),
    );
    expect(created.status).toBe(201);
    expect(lock).toHaveBeenCalledOnce();
    expect(provider.files.has('src/content/notes/diary/hello.md')).toBe(true);

    const { notesEntryRoute } = await loadRoutes();
    const fetched = await notesEntryRoute(
      mockContext('GET', '/api/notes/diary/hello.md', {
        token: TOKEN,
        params: { path: 'diary/hello.md' },
      }),
    );
    expect(fetched.status).toBe(200);
    const fetchedNote = (await bodyOf(fetched)).note as { revision: string };

    const updated = await notesEntryRoute(
      mockContext('PUT', '/api/notes/diary/hello.md', {
        token: TOKEN,
        origin: 'https://evil.example',
        params: { path: 'diary/hello.md' },
        body: {
          content: '# hello\n\nfrom the route',
          revision: fetchedNote.revision,
        },
      }),
    );
    expect(updated.status).toBe(200);
    expect(lock).toHaveBeenCalledTimes(2);

    const listed = await notesCollectionRoute(
      mockContext('GET', '/api/notes', { token: TOKEN }),
    );
    expect(listed.status).toBe(200);
    expect(await bodyOf(listed)).toMatchObject({
      notes: [{ path: 'diary/hello.md', title: 'hello' }],
    });
    expect(readStableContentVersion).toHaveBeenCalled();
    expect(lock).toHaveBeenCalledTimes(2);
  });

  it('returns the rate limiter response before touching the store', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    const limited = Response.json(
      { error: 'Too many requests. Please slow down.', code: 'rate_limited' },
      { status: 429 },
    );
    const { lock } = installStore({ rateLimit: limited });
    const { notesEntryRoute } = await loadRoutes();

    const response = await notesEntryRoute(
      mockContext('PUT', '/api/notes/diary/hello.md', {
        token: TOKEN,
        params: { path: 'diary/hello.md' },
        body: { content: '# hello\n' },
      }),
    );

    expect(response.status).toBe(429);
    expect(await bodyOf(response)).toMatchObject({ code: 'rate_limited' });
    expect(lock).not.toHaveBeenCalled();
  });

  it('answers 405 for collection delete and for move methods other than POST', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    const { provider } = installStore();
    provider.files.set('src/content/notes/diary/hello.md', {
      path: 'src/content/notes/diary/hello.md',
      content: '# hello\n',
      encoding: 'utf8',
      byteLength: 8,
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 'r1',
    });
    const { notesCollectionRoute, notesMoveRoute } = await loadRoutes();

    const collection = await notesCollectionRoute(
      mockContext('DELETE', '/api/notes', { token: TOKEN }),
    );
    const move = await notesMoveRoute(
      mockContext('DELETE', '/api/notes/move', { token: TOKEN }),
    );

    expect(collection.status).toBe(405);
    expect(collection.headers.get('Allow')).toBe('GET, POST');
    expect(move.status).toBe(405);
    expect(move.headers.get('Allow')).toBe('POST');
    expect(provider.files.has('src/content/notes/diary/hello.md')).toBe(true);
  });

  it('rejects an oversized body before taking the content lock', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    const { lock } = installStore();
    const { notesCollectionRoute } = await loadRoutes();
    const response = await notesCollectionRoute(
      mockContext('POST', '/api/notes', {
        token: TOKEN,
        origin: 'https://evil.example',
        headers: { 'Content-Length': String(MAX_NOTES_API_BYTES + 1) },
      }),
    );

    expect(response.status).toBe(413);
    expect(await bodyOf(response)).toMatchObject({ code: 'payload_too_large' });
    expect(lock).not.toHaveBeenCalled();
  });

  it('reports an unconfigured content store after the token checks out', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    installStore({ configured: false });
    const { notesCollectionRoute } = await loadRoutes();
    const response = await notesCollectionRoute(
      mockContext('GET', '/api/notes', { token: TOKEN }),
    );

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toMatchObject({
      code: 'content_store_unavailable',
    });
  });

  it('still requires the admin session cookie on admin content routes', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    vi.stubEnv('ADMIN_PANEL_TOKEN', ADMIN_TOKEN);
    vi.stubEnv('COMMUNITY_SIGNING_SECRET', SIGNING_SECRET);
    const { adminContentCollectionRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionRoute(
      mockContext('POST', '/api/admin/content/notes', {
        token: TOKEN,
        origin: ORIGIN,
        params: { collection: 'notes' },
        body: { slug: 'hello', body: '# hello' },
      }),
    );

    expect(response.status).toBe(401);
    expect(await bodyOf(response)).toMatchObject({ code: 'unauthorized' });
  });

  it('requires the bearer token to move, delete, or restore a note', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    const { provider, lock } = installStore();
    provider.files.set('src/content/notes/diary/hello.md', {
      path: 'src/content/notes/diary/hello.md',
      content: '# hello\n',
      encoding: 'utf8',
      byteLength: 8,
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 'r1',
    });
    const { notesEntryRoute, notesMoveRoute, notesRestoreRoute } =
      await loadRoutes();

    const responses = await Promise.all([
      notesMoveRoute(
        mockContext('POST', '/api/notes/move', {
          body: { from: 'diary/hello.md', to: 'reading/hello.md' },
        }),
      ),
      notesEntryRoute(
        mockContext('DELETE', '/api/notes/diary/hello.md', {
          params: { path: 'diary/hello.md' },
        }),
      ),
      notesRestoreRoute(
        mockContext('POST', '/api/notes/restore', {
          body: { path: 'diary/hello.md' },
        }),
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(await bodyOf(response)).toMatchObject({ code: 'unauthorized' });
    }
    expect(lock).not.toHaveBeenCalled();
    expect(provider.files.has('src/content/notes/diary/hello.md')).toBe(true);
    expect(provider.tombstones.size).toBe(0);
    expect(provider.redirects.size).toBe(0);
  });

  it('moves, soft-deletes, and restores through the token routes', async () => {
    vi.stubEnv('NOTES_API_TOKEN', TOKEN);
    const { provider, lock } = installStore();
    const {
      notesCollectionRoute,
      notesEntryRoute,
      notesMoveRoute,
      notesRestoreRoute,
    } = await loadRoutes();

    const created = await notesCollectionRoute(
      mockContext('POST', '/api/notes', {
        token: TOKEN,
        body: { path: 'diary/hello.md', content: '# hello\n\nfrom the route' },
      }),
    );
    expect(created.status).toBe(201);
    const revision = ((await bodyOf(created)).note as { revision: string })
      .revision;

    const moved = await notesMoveRoute(
      mockContext('POST', '/api/notes/move', {
        token: TOKEN,
        body: {
          from: 'diary/hello.md',
          to: 'reading/hello.md',
          revision,
        },
      }),
    );
    expect(moved.status).toBe(200);
    const movedRevision = ((await bodyOf(moved)).note as { revision: string })
      .revision;
    expect(provider.redirects.get('diary/hello')).toBe('reading/hello');

    const removed = await notesEntryRoute(
      mockContext('DELETE', '/api/notes/reading/hello.md', {
        token: TOKEN,
        params: { path: 'reading/hello.md' },
        body: { revision: movedRevision },
      }),
    );
    expect(removed.status).toBe(200);
    expect(provider.files.has('src/content/notes/reading/hello.md')).toBe(
      false,
    );
    expect(provider.tombstones.has('reading/hello')).toBe(true);

    const restored = await notesRestoreRoute(
      mockContext('POST', '/api/notes/restore', {
        token: TOKEN,
        body: { path: 'reading/hello.md' },
      }),
    );
    expect(restored.status).toBe(200);
    expect(provider.files.has('src/content/notes/reading/hello.md')).toBe(true);
    expect(provider.tombstones.size).toBe(0);
    expect(lock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('is disabled for move when the token is unset', async () => {
    vi.stubEnv('NOTES_API_TOKEN', '');
    const { lock } = installStore();
    const { notesMoveRoute } = await loadRoutes();
    const response = await notesMoveRoute(
      mockContext('POST', '/api/notes/move', {
        token: TOKEN,
        body: { from: 'diary/hello.md', to: 'reading/hello.md' },
      }),
    );
    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toMatchObject({
      code: 'notes_api_disabled',
    });
    expect(lock).not.toHaveBeenCalled();
  });
});
