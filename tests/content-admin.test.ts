import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  handleContentCollection,
  handleContentEntry,
  handleContentMove,
  handleContentReorder,
} from '../src/lib/server/content/entries';
import { handleContentFolders } from '../src/lib/server/content/folders';
import { createLocalContentProvider } from '../src/lib/server/content/local-provider';
import { handleContentMedia } from '../src/lib/server/content/media';
import {
  assertSafeRepositoryPath,
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
} from '../src/lib/server/content/types';
import type {
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

  async listFiles(directory: string, extension?: string) {
    const prefix = `${directory}/`;
    const suffix = extension ? `.${extension}` : '';
    return [...this.files.values()].filter(
      (file) =>
        file.path.startsWith(prefix) &&
        (!extension || file.path.endsWith(suffix)),
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
    if (!current || current.revision !== revision) {
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
    if (!current || current.revision !== revision) {
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

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

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
      'src/content/notes/index.mdx',
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
    expect(provider.files.has('src/content/notes/reading.mdx')).toBe(true);

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
    expect(provider.files.has('src/content/notes/library/books.mdx')).toBe(
      true,
    );
    expect(provider.files.has('src/content/notes/library.mdx')).toBe(true);

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

  it('does not create a folder whose page would duplicate a note id', async () => {
    const provider = new MemoryContentProvider();
    await provider.writeTextFile(
      'src/content/notes/elsewhere/shared.mdx',
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
        `src/content/notes/${slug}.mdx`,
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
    const alpha = provider.files.get('src/content/notes/alpha.mdx');
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

  it('verifies image bytes and supports listing and deletion', async () => {
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
    const uploadedBody = await payload<{ media: { url: string } }>(uploaded);

    const listed = await handleContentMedia(
      provider,
      new Request('https://oddava.me/api/admin/content/media'),
    );
    await expect(listed.json()).resolves.toMatchObject({
      media: [{ url: uploadedBody.media.url, size: 8 }],
    });

    const deleted = await handleContentMedia(
      provider,
      jsonRequest('DELETE', 'https://oddava.me/api/admin/content/media', {
        url: uploadedBody.media.url,
      }),
    );
    expect(deleted.status).toBe(200);
  });
});

describe('local content provider', () => {
  it('confines writes to the repository and rejects stale revisions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oddava-content-'));
    temporaryDirectories.push(root);
    const provider = createLocalContentProvider(root);

    const created = await provider.writeTextFile(
      'src/content/notes/hello.mdx',
      '# hello',
      'create',
    );
    expect(created.revision).toHaveLength(64);
    await expect(
      provider.writeTextFile(
        'src/content/notes/hello.mdx',
        '# changed',
        'update',
        created.revision,
      ),
    ).resolves.toMatchObject({ revision: expect.any(String) });
    await expect(
      provider.writeTextFile(
        'src/content/notes/hello.mdx',
        '# stale',
        'update',
        created.revision,
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(
      provider.writeTextFile('../outside.mdx', '# no', 'escape'),
    ).rejects.toThrow('Unsafe content path');

    const concurrent = await provider.writeTextFile(
      'src/content/notes/concurrent.mdx',
      '# original',
      'create',
    );
    const writes = await Promise.allSettled([
      provider.writeTextFile(
        'src/content/notes/concurrent.mdx',
        '# first',
        'update',
        concurrent.revision,
      ),
      provider.writeTextFile(
        'src/content/notes/concurrent.mdx',
        '# second',
        'update',
        concurrent.revision,
      ),
    ]);
    expect(writes.filter((write) => write.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(writes.filter((write) => write.status === 'rejected')).toHaveLength(
      1,
    );
  });

  it('serializes compound Studio mutations across the whole route handler', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oddava-content-'));
    temporaryDirectories.push(root);
    const { createLocalContentRouteHandler } =
      await import('../vite/local-content-route-handler');
    const handle = createLocalContentRouteHandler(root);

    for (const folder of ['first', 'second']) {
      const response = await handle(
        jsonRequest(
          'POST',
          'https://oddava.me/api/admin/content/notes/folders',
          { path: folder },
        ),
      );
      expect(response.status).toBe(201);
    }

    const responses = await Promise.all(
      ['first', 'second'].map((folder) =>
        handle(
          jsonRequest('POST', 'https://oddava.me/api/admin/content/notes', {
            slug: 'same-id',
            folder,
            fields: {},
            body: '# same id',
          }),
        ),
      ),
    );

    expect(responses.map((response) => response.status).toSorted()).toEqual([
      201, 409,
    ]);
  });

  it('rejects repository paths that traverse an existing symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oddava-content-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'oddava-outside-'));
    temporaryDirectories.push(root, outside);
    const notesDirectory = path.join(root, 'src/content/notes');
    await mkdir(notesDirectory, { recursive: true });
    await symlink(
      outside,
      path.join(notesDirectory, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const provider = createLocalContentProvider(root);

    await expect(
      provider.writeTextFile(
        'src/content/notes/linked/escape.mdx',
        '# no',
        'escape',
      ),
    ).rejects.toThrow('symbolic links are not allowed');
    await expect(
      provider.deleteDirectory('src/content/notes/linked', 'delete'),
    ).rejects.toThrow('symbolic links are not allowed');
  });
});
