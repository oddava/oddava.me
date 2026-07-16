import { describe, expect, it } from 'vitest';
import {
  handleContentCollection,
  handleContentEntry,
  handleContentMove,
  handleContentReorder,
} from '../src/lib/server/content/entries';
import { handleContentFolders } from '../src/lib/server/content/folders';
import { handleContentMedia } from '../src/lib/server/content/media';
import {
  assertSafeRepositoryPath,
  matchesExtension,
  normalizeFolderPath,
  sanitizeFilename,
  slugify,
} from '../src/lib/server/content/paths';
import {
  parseContentDocument,
  serializeContentDocument,
} from '../src/lib/server/content/serializers';
import {
  ContentConflictError,
  ContentFolderNotEmptyError,
  ContentNotFoundError,
} from '../src/lib/server/content/types';
import type {
  BatchTextWrite,
  ContentProvider,
  ContentSourceFile,
  ContentWriteResult,
  LinkedFileDelete,
  LinkedFileMove,
} from '../src/lib/server/content/types';

class MemoryContentProvider implements ContentProvider {
  readonly files = new Map<string, ContentSourceFile>();
  readonly directories = new Set<string>();
  private revision = 0;

  private nextFile(
    path: string,
    content: string,
    encoding: 'utf8' | 'base64' = 'utf8',
  ): ContentSourceFile {
    this.revision += 1;
    return {
      path,
      content,
      encoding,
      byteLength:
        encoding === 'utf8'
          ? new TextEncoder().encode(content).byteLength
          : Buffer.byteLength(content, 'base64'),
      updatedAt: new Date(2026, 0, this.revision).toISOString(),
      revision: `r${this.revision}`,
    };
  }

  private addAncestors(filePath: string) {
    const parts = filePath.split('/');
    parts.pop();
    for (let index = 1; index <= parts.length; index += 1) {
      this.directories.add(parts.slice(0, index).join('/'));
    }
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

  async listDirectories(directory: string) {
    const prefix = `${directory}/`;
    return [...this.directories].filter((item) => item.startsWith(prefix));
  }

  async createDirectory(path: string, message: string) {
    this.addAncestors(`${path}/placeholder`);
    return { message };
  }

  async moveFile(from: string, to: string, message: string, revision: string) {
    const current = this.files.get(from);
    if (!current) throw new ContentNotFoundError();
    if (current.revision !== revision) {
      throw new ContentConflictError('revision_conflict');
    }
    if (this.files.has(to)) throw new ContentConflictError('path_exists');
    const moved = this.nextFile(to, current.content, current.encoding);
    this.files.delete(from);
    this.files.set(to, moved);
    this.addAncestors(to);
    return { message, revision: moved.revision };
  }

  async moveDirectory(
    from: string,
    to: string,
    message: string,
    linkedFile?: LinkedFileMove,
  ) {
    for (const [filePath, file] of [...this.files]) {
      if (!filePath.startsWith(`${from}/`)) continue;
      this.files.delete(filePath);
      const nextPath = `${to}${filePath.slice(from.length)}`;
      this.files.set(nextPath, { ...file, path: nextPath });
    }
    for (const directory of [...this.directories]) {
      if (directory !== from && !directory.startsWith(`${from}/`)) continue;
      this.directories.delete(directory);
      this.directories.add(`${to}${directory.slice(from.length)}`);
    }
    if (linkedFile) {
      await this.moveFile(
        linkedFile.from,
        linkedFile.to,
        message,
        linkedFile.revision,
      );
    }
    return { message };
  }

  async deleteDirectory(
    directory: string,
    message: string,
    linkedFile?: LinkedFileDelete,
  ) {
    if ([...this.files].some(([file]) => file.startsWith(`${directory}/`))) {
      throw new ContentFolderNotEmptyError();
    }
    for (const item of [...this.directories]) {
      if (item === directory || item.startsWith(`${directory}/`)) {
        this.directories.delete(item);
      }
    }
    if (linkedFile) {
      await this.deleteFile(linkedFile.path, message, linkedFile.revision);
    }
    return { message };
  }

  async writeTextFile(
    path: string,
    content: string,
    message: string,
    revision?: string,
  ): Promise<ContentWriteResult> {
    const current = this.files.get(path);
    if (!revision && current) throw new ContentConflictError('path_exists');
    if (revision && current?.revision !== revision) {
      throw new ContentConflictError('revision_conflict');
    }
    const file = this.nextFile(path, content);
    this.files.set(path, file);
    this.addAncestors(path);
    return { message, revision: file.revision };
  }

  // Mirrors the real providers' all-or-nothing contract: every revision is
  // checked before any file is written, so a conflict partway through leaves
  // the collection exactly as it was.
  async writeTextFiles(files: readonly BatchTextWrite[], message: string) {
    for (const file of files) {
      const current = this.files.get(file.path);
      if (!current) throw new ContentNotFoundError();
      if (current.revision !== file.revision) {
        throw new ContentConflictError('revision_conflict');
      }
    }
    const revisions: Record<string, string> = {};
    for (const file of files) {
      const written = this.nextFile(file.path, file.content);
      this.files.set(file.path, written);
      revisions[file.path] = written.revision;
    }
    return { message, revisions };
  }

  async writeBinaryFile(path: string, content: Uint8Array, message: string) {
    if (this.files.has(path)) throw new ContentConflictError('path_exists');
    const file = this.nextFile(
      path,
      Buffer.from(content).toString('base64'),
      'base64',
    );
    this.files.set(path, file);
    this.addAncestors(path);
    return { message, revision: file.revision };
  }

  async deleteFile(path: string, message: string, revision: string) {
    const current = this.files.get(path);
    if (!current) throw new ContentNotFoundError();
    if (current.revision !== revision) {
      throw new ContentConflictError('revision_conflict');
    }
    this.files.delete(path);
    return { message };
  }
}

function jsonRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function payload<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('content document primitives', () => {
  it('round-trips frontmatter and Markdown without inventing empty metadata', () => {
    const serialized = serializeContentDocument(
      { order: 2, updated: '2026-07-12T12:00:00.000Z' },
      '# hello\n\nBody.',
    );
    expect(parseContentDocument(serialized)).toEqual({
      fields: { order: 2, updated: '2026-07-12T12:00:00.000Z' },
      body: '# hello\n\nBody.',
    });
    expect(serializeContentDocument({}, '# plain')).toBe('# plain');
  });

  it('normalizes names and rejects repository traversal', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world');
    expect(normalizeFolderPath(' /reading//books/ ')).toBe('reading/books');
    expect(() => assertSafeRepositoryPath('../secrets')).toThrow(
      'Unsafe content path',
    );
    expect(sanitizeFilename('My Picture.PNG', '.png')).toMatch(
      /^my-picture-[0-9a-f-]+\.png$/,
    );
  });
});

describe('content HTTP handlers', () => {
  it('creates, reads, updates with CAS, and deletes notes', async () => {
    const provider = new MemoryContentProvider();
    const created = await handleContentCollection(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes', {
        slug: 'hello',
        fields: {},
        body: '# Hello',
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = await payload<{
      entry: { href: string; revision: string };
    }>(created);
    expect(createdBody.entry.href).toBe('/notes/hello');

    const updated = await handleContentEntry(
      provider,
      'notes',
      'hello',
      jsonRequest('PUT', 'https://oddava.me/api/admin/content/notes/hello', {
        fields: {},
        body: '# Hello again',
        revision: createdBody.entry.revision,
      }),
    );
    expect(updated.status).toBe(200);
    const updatedBody = await payload<{ entry: { revision: string } }>(updated);

    const missingRevision = await handleContentEntry(
      provider,
      'notes',
      'hello',
      jsonRequest('PUT', 'https://oddava.me/api/admin/content/notes/hello', {
        fields: {},
        body: '# unsafe overwrite',
      }),
    );
    expect(missingRevision.status).toBe(400);
    await expect(missingRevision.json()).resolves.toMatchObject({
      code: 'revision_required',
    });

    const stale = await handleContentEntry(
      provider,
      'notes',
      'hello',
      jsonRequest('PUT', 'https://oddava.me/api/admin/content/notes/hello', {
        fields: {},
        body: '# stale',
        revision: createdBody.entry.revision,
      }),
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: 'revision_conflict',
    });

    const deleted = await handleContentEntry(
      provider,
      'notes',
      'hello',
      jsonRequest('DELETE', 'https://oddava.me/api/admin/content/notes/hello', {
        revision: updatedBody.entry.revision,
      }),
    );
    expect(deleted.status).toBe(200);
  });

  it('creates, moves, duplicates, and protects non-empty folder trees', async () => {
    const provider = new MemoryContentProvider();
    await provider.writeTextFile(
      'src/content/notes/index.md',
      '# notes',
      'seed',
    );
    const createFolder = await handleContentFolders(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/folders', {
        path: 'reading',
      }),
    );
    expect(createFolder.status).toBe(201);
    expect(provider.files.has('src/content/notes/reading.md')).toBe(true);

    await handleContentCollection(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes', {
        slug: 'books',
        folder: 'reading',
        fields: {},
        body: '# books',
      }),
    );
    const moved = await handleContentFolders(
      provider,
      'notes',
      jsonRequest(
        'PATCH',
        'https://oddava.me/api/admin/content/notes/folders',
        {
          path: 'reading',
          nextPath: 'library',
        },
      ),
    );
    expect(moved.status).toBe(200);
    expect(provider.files.has('src/content/notes/library/books.md')).toBe(true);
    expect(provider.files.has('src/content/notes/library.md')).toBe(true);

    const duplicate = await handleContentFolders(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/folders', {
        path: 'library-copy',
        copyFrom: 'library',
      }),
    );
    expect(duplicate.status).toBe(201);

    const notEmpty = await handleContentFolders(
      provider,
      'notes',
      jsonRequest(
        'DELETE',
        'https://oddava.me/api/admin/content/notes/folders',
        {
          path: 'library',
        },
      ),
    );
    expect(notEmpty.status).toBe(409);
  });

  it('rolls back every path when a folder duplicate fails midway', async () => {
    const provider = new MemoryContentProvider();
    await provider.createDirectory('src/content/notes/source', 'mkdir');
    await provider.writeTextFile(
      'src/content/notes/source.md',
      '# source',
      'seed page',
    );
    await provider.writeTextFile(
      'src/content/notes/source/child.md',
      '# child',
      'seed child',
    );
    const writeTextFile = provider.writeTextFile.bind(provider);
    let failed = false;
    provider.writeTextFile = async (...arguments_) => {
      if (!failed && arguments_[0].includes('source-copy/')) {
        failed = true;
        throw new Error('simulated transport failure');
      }
      return writeTextFile(...arguments_);
    };

    await expect(
      handleContentFolders(
        provider,
        'notes',
        jsonRequest(
          'POST',
          'https://oddava.me/api/admin/content/notes/folders',
          { path: 'source-copy', copyFrom: 'source' },
        ),
      ),
    ).rejects.toThrow('simulated transport failure');

    expect(
      [...provider.files].filter(
        ([path]) =>
          path === 'src/content/notes/source-copy.md' ||
          path.startsWith('src/content/notes/source-copy/'),
      ),
    ).toEqual([]);
    expect(
      [...provider.directories].some((path) =>
        path.startsWith('src/content/notes/source-copy'),
      ),
    ).toBe(false);
  });

  it('does not create a folder whose page would duplicate a note id', async () => {
    const provider = new MemoryContentProvider();
    await provider.writeTextFile(
      'src/content/notes/elsewhere/shared.md',
      '# shared',
      'seed',
    );

    const response = await handleContentFolders(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/folders', {
        path: 'shared',
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'slug_exists',
    });
    expect(provider.directories.has('src/content/notes/shared')).toBe(false);
  });

  it('moves notes and validates complete sibling reorder requests', async () => {
    const provider = new MemoryContentProvider();
    for (const slug of ['index', 'alpha', 'beta']) {
      await provider.writeTextFile(
        `src/content/notes/${slug}.md`,
        `# ${slug}`,
        'seed',
      );
    }
    const reordered = await handleContentReorder(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/reorder', {
        folder: '',
        ids: ['beta', 'alpha'],
      }),
    );
    expect(reordered.status).toBe(200);

    await provider.createDirectory('src/content/notes/archive', 'mkdir');
    const alpha = provider.files.get('src/content/notes/alpha.md');
    expect(alpha).toBeDefined();
    const moved = await handleContentMove(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/move', {
        id: 'alpha',
        nextId: 'first',
        folder: 'archive',
        revision: alpha!.revision,
      }),
    );
    expect(moved.status).toBe(200);
    await expect(moved.json()).resolves.toMatchObject({
      entry: { id: 'first', href: '/notes/archive/first' },
    });
  });

  it('moves a folder page together with its folder', async () => {
    // `reading.md` beside `reading/` is one thing to the author. Moving the
    // page alone leaves the folder with no page and the page with no folder,
    // and no later single operation puts the pair back together.
    const provider = new MemoryContentProvider();
    for (const slug of ['index', 'reading']) {
      await provider.writeTextFile(
        `src/content/notes/${slug}.md`,
        `# ${slug}`,
        'seed',
      );
    }
    await provider.writeTextFile(
      'src/content/notes/reading/books.md',
      '# books',
      'seed',
    );
    await provider.createDirectory('src/content/notes/archive', 'mkdir');

    const page = provider.files.get('src/content/notes/reading.md')!;
    const response = await handleContentMove(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/move', {
        id: 'reading',
        nextId: 'reading',
        folder: 'archive',
        revision: page.revision,
      }),
    );

    expect(response.status).toBe(200);
    // The page moved...
    expect(provider.files.has('src/content/notes/archive/reading.md')).toBe(
      true,
    );
    expect(provider.files.has('src/content/notes/reading.md')).toBe(false);
    // ...and so did the folder it belongs to, with its children.
    expect(
      provider.files.has('src/content/notes/archive/reading/books.md'),
    ).toBe(true);
    expect(provider.files.has('src/content/notes/reading/books.md')).toBe(
      false,
    );
    expect(provider.directories.has('src/content/notes/archive/reading')).toBe(
      true,
    );
  });

  it('refuses to move a folder page into its own folder', async () => {
    const provider = new MemoryContentProvider();
    for (const slug of ['index', 'reading']) {
      await provider.writeTextFile(
        `src/content/notes/${slug}.md`,
        `# ${slug}`,
        'seed',
      );
    }
    await provider.createDirectory('src/content/notes/reading', 'mkdir');

    const page = provider.files.get('src/content/notes/reading.md')!;
    const response = await handleContentMove(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/move', {
        id: 'reading',
        nextId: 'reading',
        folder: 'reading',
        revision: page.revision,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'invalid_folder_move',
    });
  });

  it('returns a revision for every entry it reordered', async () => {
    const provider = new MemoryContentProvider();
    for (const slug of ['index', 'alpha', 'beta']) {
      await provider.writeTextFile(
        `src/content/notes/${slug}.md`,
        `# ${slug}`,
        'seed',
      );
    }

    const response = await handleContentReorder(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/reorder', {
        folder: '',
        ids: ['beta', 'alpha'],
      }),
    );

    expect(response.status).toBe(200);
    // The client needs these to keep editing without a refresh, so a reorder
    // that reports no revision is a reorder that costs the author their next
    // save.
    await expect(response.json()).resolves.toMatchObject({
      reordered: [
        { id: 'beta', ok: true, revision: expect.any(String) },
        { id: 'alpha', ok: true, revision: expect.any(String) },
      ],
    });
  });

  it('duplicates a folder page together with its folder', async () => {
    const provider = new MemoryContentProvider();
    for (const slug of ['index', 'reading']) {
      await provider.writeTextFile(
        `src/content/notes/${slug}.md`,
        `# ${slug}`,
        'seed',
      );
    }
    await provider.writeTextFile(
      'src/content/notes/reading/books.md',
      '# books',
      'seed',
    );

    const page = provider.files.get('src/content/notes/reading.md')!;
    const response = await handleContentMove(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/move', {
        id: 'reading',
        nextId: 'reading-copy',
        folder: '',
        operation: 'duplicate',
        revision: page.revision,
      }),
    );

    expect(response.status).toBe(200);
    // A copy of a folder page is a copy of the folder. Copying the one file
    // would make a page for a folder that does not exist.
    expect(provider.files.has('src/content/notes/reading-copy.md')).toBe(true);
    expect(provider.directories.has('src/content/notes/reading-copy')).toBe(
      true,
    );
    expect(
      [...provider.files.keys()].some((filePath) =>
        filePath.startsWith('src/content/notes/reading-copy/'),
      ),
    ).toBe(true);
    // And the original is untouched.
    expect(provider.files.has('src/content/notes/reading.md')).toBe(true);
    expect(provider.files.has('src/content/notes/reading/books.md')).toBe(true);
  });

  it('deletes a folder page together with its empty folder', async () => {
    const provider = new MemoryContentProvider();
    for (const slug of ['index', 'reading']) {
      await provider.writeTextFile(
        `src/content/notes/${slug}.md`,
        `# ${slug}`,
        'seed',
      );
    }
    await provider.createDirectory('src/content/notes/reading', 'mkdir');

    const page = provider.files.get('src/content/notes/reading.md')!;
    const response = await handleContentEntry(
      provider,
      'notes',
      'reading',
      jsonRequest(
        'DELETE',
        'https://oddava.me/api/admin/content/notes/reading',
        { revision: page.revision },
      ),
    );

    expect(response.status).toBe(200);
    expect(provider.files.has('src/content/notes/reading.md')).toBe(false);
    // The folder went with it. Left behind, it would be a folder with no page.
    expect(provider.directories.has('src/content/notes/reading')).toBe(false);
  });

  it('refuses to delete a folder page while its folder still holds notes', async () => {
    const provider = new MemoryContentProvider();
    for (const slug of ['index', 'reading']) {
      await provider.writeTextFile(
        `src/content/notes/${slug}.md`,
        `# ${slug}`,
        'seed',
      );
    }
    await provider.writeTextFile(
      'src/content/notes/reading/books.md',
      '# books',
      'seed',
    );

    const page = provider.files.get('src/content/notes/reading.md')!;
    const response = await handleContentEntry(
      provider,
      'notes',
      'reading',
      jsonRequest(
        'DELETE',
        'https://oddava.me/api/admin/content/notes/reading',
        { revision: page.revision },
      ),
    );

    // Same answer the folders API gives, because it is the same question.
    // Deleting the page alone would strand books.md under a folder with no page.
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'folder_not_empty',
    });
    expect(provider.files.has('src/content/notes/reading.md')).toBe(true);
    expect(provider.files.has('src/content/notes/reading/books.md')).toBe(true);
  });

  it('still deletes an ordinary note that has no folder', async () => {
    const provider = new MemoryContentProvider();
    for (const slug of ['index', 'alpha']) {
      await provider.writeTextFile(
        `src/content/notes/${slug}.md`,
        `# ${slug}`,
        'seed',
      );
    }

    const alpha = provider.files.get('src/content/notes/alpha.md')!;
    const response = await handleContentEntry(
      provider,
      'notes',
      'alpha',
      jsonRequest('DELETE', 'https://oddava.me/api/admin/content/notes/alpha', {
        revision: alpha.revision,
      }),
    );

    expect(response.status).toBe(200);
    expect(provider.files.has('src/content/notes/alpha.md')).toBe(false);
  });

  it('reports a vanished move source as gone, not as changed', async () => {
    // "This content changed since you opened it. Refresh and try again." is
    // advice that cannot work when the answer is that the content is gone.
    const provider = new MemoryContentProvider();
    await provider.writeTextFile(
      'src/content/notes/index.md',
      '# index',
      'seed',
    );
    await provider.writeTextFile(
      'src/content/notes/alpha.md',
      '# alpha',
      'seed',
    );
    await provider.createDirectory('src/content/notes/archive', 'mkdir');
    const alpha = provider.files.get('src/content/notes/alpha.md')!;

    // Deleted between the read and the write — the race the CAS exists for.
    provider.files.delete('src/content/notes/alpha.md');

    await expect(
      provider.moveFile(
        'src/content/notes/alpha.md',
        'src/content/notes/archive/alpha.md',
        'move',
        alpha.revision,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('verifies image bytes on upload', async () => {
    const provider = new MemoryContentProvider();
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'cover.png',
      { type: 'image/png' },
    );
    const form = new FormData();
    form.set('collection', 'notes');
    form.set('entryId', 'hello');
    form.set('file', png);
    const uploaded = await handleContentMedia(
      provider,
      new Request('https://oddava.me/api/admin/content/media', {
        method: 'POST',
        body: form,
      }),
    );
    expect(uploaded.status).toBe(201);
    const body = await payload<{ media: { url: string } }>(uploaded);
    // sanitizeFilename appends a uuid, so match the shape rather than the name.
    expect(body.media.url).toMatch(
      /^\/images\/notes\/hello\/cover-[\w-]+\.png$/,
    );
  });

  it('rejects a method other than POST', async () => {
    const provider = new MemoryContentProvider();
    const listed = await handleContentMedia(
      provider,
      new Request('https://oddava.me/api/admin/content/media'),
    );
    expect(listed.status).toBe(405);
  });
});

// The live store still holds `.mdx` keys written before notes moved to `.md`,
// and will until notes:migrate runs against it. Studio has to keep working
// across that gap, in either order.
describe('a content store still holding legacy .mdx notes', () => {
  async function storeWithLegacyNotes() {
    const provider = new MemoryContentProvider();
    await provider.writeTextFile(
      'src/content/notes/index.mdx',
      '# notes',
      'seed root',
    );
    await provider.writeTextFile(
      'src/content/notes/reading.mdx',
      '# reading',
      'seed folder page',
    );
    await provider.writeTextFile(
      'src/content/notes/reading/books.mdx',
      '# books',
      'seed note',
    );
    return provider;
  }

  it('lists legacy notes rather than reporting an empty collection', async () => {
    const listed = await handleContentCollection(
      await storeWithLegacyNotes(),
      'notes',
      new Request('https://oddava.me/api/admin/content/notes'),
    );
    expect(listed.status).toBe(200);
    const body = await payload<{ entries: { id: string }[] }>(listed);
    expect(body.entries.map((entry) => entry.id).toSorted()).toEqual([
      'books',
      'index',
      'reading',
    ]);
  });

  it('reads a legacy note by its id, extension and all', async () => {
    const read = await handleContentEntry(
      await storeWithLegacyNotes(),
      'notes',
      'books',
      new Request('https://oddava.me/api/admin/content/notes/books'),
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      entry: { id: 'books', body: '# books' },
    });
  });

  it('refuses to delete the root note even when it is index.mdx', async () => {
    // The root guard compared against a hardcoded `index.mdx`. Were it to
    // compare against only the canonical `.md`, a legacy root would become
    // deletable — the one file the garden cannot survive losing.
    const deleted = await handleContentEntry(
      await storeWithLegacyNotes(),
      'notes',
      'index',
      jsonRequest('DELETE', 'https://oddava.me/api/admin/content/notes/index', {
        revision: 'r1',
      }),
    );
    expect(deleted.status).toBe(400);
  });

  it('does not duplicate a legacy folder page when creating the folder', async () => {
    const provider = await storeWithLegacyNotes();
    const created = await handleContentFolders(
      provider,
      'notes',
      jsonRequest('POST', 'https://oddava.me/api/admin/content/notes/folders', {
        path: 'reading',
      }),
    );
    expect(created.status).toBe(409);

    // Two pages for one folder would collapse to one note id and throw
    // "Duplicate note id" when the garden index next rebuilt.
    expect(provider.files.has('src/content/notes/reading.md')).toBe(false);
    expect(provider.files.has('src/content/notes/reading.mdx')).toBe(true);
  });

  it('renames a legacy folder page onto the canonical extension', async () => {
    const provider = await storeWithLegacyNotes();
    const renamed = await handleContentFolders(
      provider,
      'notes',
      jsonRequest(
        'PATCH',
        'https://oddava.me/api/admin/content/notes/folders',
        { path: 'reading', nextPath: 'library' },
      ),
    );
    expect(renamed.status).toBe(200);
    expect(provider.files.has('src/content/notes/library.md')).toBe(true);
    expect(provider.files.has('src/content/notes/reading.mdx')).toBe(false);
  });
});
