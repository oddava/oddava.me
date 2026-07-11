import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  handleContentCollection,
  handleContentDraft,
  handleContentEntry,
  handleContentFolders,
  handleContentMedia,
  handleContentMove,
  handleContentPreview,
  handleContentPublish,
  handleContentReorder,
} from '../src/lib/server/content/api';
import { blocksToBody, bodyToBlocks } from '../src/lib/server/content/blocks';
import { createLocalContentProvider } from '../src/lib/server/content/local-provider';
import {
  assertSafeRepositoryPath,
  entryFolderFromPath,
  isValidFolderPath,
  isValidSlug,
  sanitizeFilename,
  slugify,
} from '../src/lib/server/content/paths';
import {
  parseContentDocument,
  serializeContentDocument,
} from '../src/lib/server/content/serializers';
import type {
  ContentProvider,
  ContentSourceFile,
  ContentWriteResult,
} from '../src/lib/server/content/types';

class MemoryContentProvider implements ContentProvider {
  kind = 'local' as const;
  files = new Map<string, ContentSourceFile>();
  revision = 0;
  binaries = new Map<string, Uint8Array>();
  folders = new Set<string>();

  registerParentDirectories(filePath: string) {
    const segments = filePath.split('/');
    segments.pop();
    for (let index = 1; index <= segments.length; index += 1) {
      this.folders.add(segments.slice(0, index).join('/'));
    }
  }

  async listFiles(directory: string, extension: string) {
    return [...this.files.values()].filter(
      (file) =>
        file.path.startsWith(`${directory}/`) &&
        file.path.endsWith(`.${extension}`),
    );
  }

  async readFile(path: string) {
    return this.files.get(path) ?? null;
  }

  async listDirectories(directory: string) {
    return [...this.folders].filter(
      (folder) => folder.startsWith(`${directory}/`) && folder !== directory,
    );
  }

  async createDirectory(path: string, message: string) {
    this.registerParentDirectories(`${path}/.gitkeep`);
    return { provider: 'local' as const, message };
  }

  async movePath(
    from: string,
    to: string,
    message: string,
  ): Promise<ContentWriteResult> {
    const file = this.files.get(from);
    if (file) {
      this.files.delete(from);
      this.files.set(to, { ...file, path: to });
      this.registerParentDirectories(to);
      return { provider: 'local', message };
    }

    const movedFiles = [...this.files.entries()].filter(([filePath]) =>
      filePath.startsWith(`${from}/`),
    );
    for (const [filePath, source] of movedFiles) {
      this.files.delete(filePath);
      const nextPath = `${to}${filePath.slice(from.length)}`;
      this.files.set(nextPath, { ...source, path: nextPath });
      this.registerParentDirectories(nextPath);
    }
    const movedFolders = [...this.folders].filter(
      (folder) => folder === from || folder.startsWith(`${from}/`),
    );
    for (const folder of movedFolders) {
      this.folders.delete(folder);
      this.folders.add(`${to}${folder.slice(from.length)}`);
    }
    return { provider: 'local', message };
  }

  async deleteDirectory(
    path: string,
    message: string,
  ): Promise<ContentWriteResult> {
    if ([...this.files.keys()].some((file) => file.startsWith(`${path}/`))) {
      throw Object.assign(new Error('Folder is not empty.'), {
        code: 'folder_not_empty',
      });
    }
    for (const folder of [...this.folders]) {
      if (folder === path || folder.startsWith(`${path}/`)) {
        this.folders.delete(folder);
      }
    }
    return { provider: 'local', message };
  }

  async writeTextFile(
    path: string,
    content: string,
    message: string,
  ): Promise<ContentWriteResult> {
    const revision = `rev-${++this.revision}`;
    this.files.set(path, { path, content, revision });
    this.registerParentDirectories(path);
    return { provider: 'local', revision, message };
  }

  async writeBinaryFile(
    path: string,
    content: Uint8Array,
    message: string,
  ): Promise<ContentWriteResult> {
    const revision = `rev-${++this.revision}`;
    this.binaries.set(path, content);
    return { provider: 'local', revision, message };
  }

  async deleteFile(path: string, message: string): Promise<ContentWriteResult> {
    this.files.delete(path);
    return { provider: 'local', message };
  }
}

const jsonRequest = (method: string, body: unknown) =>
  new Request('https://oddava.me/api/admin/content/notes', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('content admin serializers and paths', () => {
  it('round-trips MDX frontmatter and body', () => {
    const serialized = serializeContentDocument(
      {
        title: 'Hello',
        date: '2026-07-03',
        draft: false,
      },
      '# Body',
      'mdx',
    );

    expect(serialized).toContain('title: Hello');
    expect(parseContentDocument(serialized, 'mdx')).toEqual({
      fields: {
        title: 'Hello',
        date: '2026-07-03',
        draft: false,
      },
      body: '# Body',
    });
  });

  it('normalizes slugs and rejects unsafe paths', () => {
    expect(slugify('My First Post!')).toBe('my-first-post');
    expect(isValidSlug('my-first-post')).toBe(true);
    expect(isValidFolderPath('reading/books')).toBe(true);
    expect(isValidFolderPath('reading//books')).toBe(true);
    expect(isValidFolderPath('../private')).toBe(false);
    expect(
      entryFolderFromPath(
        'src/content/notes/reading/books/example.mdx',
        'src/content/notes',
      ),
    ).toBe('reading/books');
    expect(isValidSlug('../bad')).toBe(false);
    expect(() => assertSafeRepositoryPath('../bad')).toThrow(
      'Unsafe content path.',
    );
    expect(sanitizeFilename('My Cover.PNG')).toMatch(/^my-cover-.+\.png$/);
  });

  it('converts MDX bodies into editable blocks without losing raw MDX', () => {
    const blocks = bodyToBlocks(
      [
        '## Hello',
        'Opening paragraph.',
        '![](/images/blog/example/cover.webp)',
        '<CardComparison before="a" after="b" />',
      ].join('\n\n'),
    );

    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'image',
      'raw-mdx',
    ]);
    expect(blocksToBody(blocks)).toContain(
      '<CardComparison before="a" after="b" />',
    );
  });
});

describe('content admin API core', () => {
  it('creates, updates, lists, and deletes entries', async () => {
    const provider = new MemoryContentProvider();

    const createResponse = await handleContentCollection(
      provider,
      'notes',
      jsonRequest('POST', {
        slug: 'hello-world',
        fields: {
          draft: false,
        },
        body: '# Hello world\n\nBody copy',
      }),
    );

    expect(createResponse.status).toBe(201);
    expect(
      provider.files.get('src/content/notes/hello-world.mdx')?.content,
    ).toContain('Body copy');

    const duplicateResponse = await handleContentCollection(
      provider,
      'notes',
      jsonRequest('POST', {
        slug: 'hello-world',
        fields: { draft: false },
        body: '# Hello again',
      }),
    );
    expect(duplicateResponse.status).toBe(409);

    const listResponse = await handleContentCollection(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes'),
    );
    await expect(listResponse.json()).resolves.toMatchObject({
      entries: [{ id: 'hello-world', title: 'Hello world' }],
    });

    const updateResponse = await handleContentEntry(
      provider,
      'notes',
      'hello-world',
      jsonRequest('PUT', {
        fields: {
          draft: true,
        },
        body: '# Updated\n\nUpdated body',
      }),
    );
    expect(updateResponse.status).toBe(200);
    expect(
      provider.files.get('src/content/notes/hello-world.mdx')?.content,
    ).toContain('Updated body');

    const deleteResponse = await handleContentEntry(
      provider,
      'notes',
      'hello-world',
      new Request('https://oddava.me/api/admin/content/notes/hello-world', {
        method: 'DELETE',
      }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(provider.files.has('src/content/notes/hello-world.mdx')).toBe(false);
  });

  it('rejects unsafe slugs', async () => {
    const response = await handleContentCollection(
      new MemoryContentProvider(),
      'notes',
      jsonRequest('POST', {
        slug: '../escape',
        fields: { draft: false },
        body: '# Escape',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('saves drafts, previews them, and publishes back to MDX files', async () => {
    const provider = new MemoryContentProvider();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oddava-studio-'));

    try {
      const draftResponse = await handleContentDraft(
        tempDir,
        provider,
        'notes',
        'hello-studio',
        new Request(
          'https://oddava.me/api/admin/content/drafts/notes/hello-studio',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                draft: true,
              },
              folder: 'inbox/thoughts',
              blocks: [
                {
                  id: 'intro',
                  type: 'paragraph',
                  value: 'Drafted visually.',
                },
              ],
              isNew: true,
            }),
          },
        ),
      );

      expect(draftResponse.status).toBe(200);
      await expect(draftResponse.json()).resolves.toMatchObject({
        draft: {
          id: 'hello-studio',
          folder: 'inbox/thoughts',
          isNew: true,
        },
      });

      const previewResponse = await handleContentPreview(
        tempDir,
        provider,
        new Request(
          'https://oddava.me/api/admin/content/preview?collection=notes&id=hello-studio',
        ),
      );

      expect(previewResponse.headers.get('Content-Type')).toContain(
        'text/html',
      );
      await expect(previewResponse.text()).resolves.toContain(
        'Drafted visually.',
      );

      const publishResponse = await handleContentPublish(
        tempDir,
        provider,
        new Request('https://oddava.me/api/admin/content/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection: 'notes', id: 'hello-studio' }),
        }),
      );

      expect(publishResponse.status).toBe(200);
      expect(
        provider.files.get('src/content/notes/inbox/thoughts/hello-studio.mdx')
          ?.content,
      ).toContain('Drafted visually.');

      const deletedDraftResponse = await handleContentDraft(
        tempDir,
        provider,
        'notes',
        'hello-studio',
        new Request(
          'https://oddava.me/api/admin/content/drafts/notes/hello-studio',
        ),
      );
      await expect(deletedDraftResponse.json()).resolves.toMatchObject({
        draft: null,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('accepts supported media uploads and rejects unsupported files', async () => {
    const provider = new MemoryContentProvider();
    const formData = new FormData();
    formData.set('collection', 'notes');
    formData.set('entryId', 'my-note');
    formData.set(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'cover.webp', {
        type: 'image/webp',
      }),
    );

    const response = await handleContentMedia(
      provider,
      new Request('https://oddava.me/api/admin/content/media', {
        method: 'POST',
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.media.url).toMatch(/^\/images\/notes\/my-note\/cover-/);
    expect(provider.binaries.size).toBe(1);

    const invalid = new FormData();
    invalid.set('collection', 'notes');
    invalid.set(
      'file',
      new File(['not an image'], 'notes.txt', { type: 'text/plain' }),
    );

    const invalidResponse = await handleContentMedia(
      provider,
      new Request('https://oddava.me/api/admin/content/media', {
        method: 'POST',
        body: invalid,
      }),
    );
    expect(invalidResponse.status).toBe(400);
  });

  it('creates nested folders, moves notes, and renames empty folder trees', async () => {
    const provider = new MemoryContentProvider();
    const createFolder = await handleContentFolders(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'reading/books' }),
      }),
    );
    expect(createFolder.status).toBe(201);

    const createNote = await handleContentCollection(
      provider,
      'notes',
      jsonRequest('POST', {
        slug: 'a-small-book',
        folder: 'reading/books',
        fields: {
          title: 'A small book',
          kind: 'book',
          status: 'growing',
          draft: false,
        },
        body: 'A few lines.',
      }),
    );
    expect(createNote.status).toBe(201);
    expect(
      provider.files.has('src/content/notes/reading/books/a-small-book.mdx'),
    ).toBe(true);

    const list = await handleContentCollection(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes'),
    );
    await expect(list.json()).resolves.toMatchObject({
      entries: [
        { id: 'a-small-book', folder: 'reading/books' },
        { id: 'books', folder: 'reading' },
      ],
      folders: [
        { id: 'reading', totalNoteCount: 2 },
        { id: 'reading/books', noteCount: 1, documentId: 'books' },
      ],
    });

    const rejectNonEmptyDelete = await handleContentFolders(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/folders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'reading' }),
      }),
    );
    expect(rejectNonEmptyDelete.status).toBe(409);

    const move = await handleContentMove(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'a-small-book', folder: '' }),
      }),
    );
    expect(move.status).toBe(200);
    expect(provider.files.has('src/content/notes/a-small-book.mdx')).toBe(true);

    const rename = await handleContentFolders(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/folders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'reading', nextPath: 'library' }),
      }),
    );
    expect(rename.status).toBe(200);
    expect(provider.folders.has('src/content/notes/library/books')).toBe(true);
    expect(provider.files.has('src/content/notes/library.mdx')).toBe(true);
    expect(provider.files.has('src/content/notes/library/books.mdx')).toBe(
      true,
    );

    const removeBooks = await handleContentFolders(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/folders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'library/books' }),
      }),
    );
    expect(removeBooks.status).toBe(200);
    expect(provider.files.has('src/content/notes/library/books.mdx')).toBe(
      false,
    );

    const remove = await handleContentFolders(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/folders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'library' }),
      }),
    );
    expect(remove.status).toBe(200);
    expect(provider.files.has('src/content/notes/library.mdx')).toBe(false);
  });

  it('renames, duplicates, and manually orders files and folder trees', async () => {
    const provider = new MemoryContentProvider();
    for (const slug of ['alpha', 'beta']) {
      const response = await handleContentCollection(
        provider,
        'notes',
        jsonRequest('POST', {
          slug,
          fields: { draft: false },
          body: `# ${slug}`,
        }),
      );
      expect(response.status).toBe(201);
    }

    const reorder = await handleContentReorder(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: '', ids: ['beta', 'alpha'] }),
      }),
    );
    expect(reorder.status).toBe(200);
    expect(
      parseContentDocument(
        provider.files.get('src/content/notes/beta.mdx')!.content,
        'mdx',
      ).fields.order,
    ).toBe(0);
    expect(
      parseContentDocument(
        provider.files.get('src/content/notes/alpha.mdx')!.content,
        'mdx',
      ).fields.order,
    ).toBe(1);

    const rename = await handleContentMove(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'alpha', nextId: 'gamma', folder: '' }),
      }),
    );
    expect(rename.status).toBe(200);
    expect(provider.files.has('src/content/notes/alpha.mdx')).toBe(false);
    expect(provider.files.has('src/content/notes/gamma.mdx')).toBe(true);

    const duplicate = await handleContentMove(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'beta',
          nextId: 'beta-copy',
          folder: '',
          operation: 'duplicate',
        }),
      }),
    );
    expect(duplicate.status).toBe(200);
    expect(provider.files.has('src/content/notes/beta-copy.mdx')).toBe(true);

    for (const folder of ['reading', 'reading/books']) {
      const response = await handleContentFolders(
        provider,
        'notes',
        new Request('https://oddava.me/api/admin/content/notes/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: folder }),
        }),
      );
      expect(response.status).toBe(201);
    }
    await handleContentCollection(
      provider,
      'notes',
      jsonRequest('POST', {
        slug: 'leaf',
        folder: 'reading/books',
        fields: { draft: false },
        body: '# leaf',
      }),
    );

    const duplicateFolder = await handleContentFolders(
      provider,
      'notes',
      new Request('https://oddava.me/api/admin/content/notes/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'reading-copy',
          copyFrom: 'reading',
        }),
      }),
    );
    expect(duplicateFolder.status).toBe(201);
    expect(provider.files.has('src/content/notes/reading-copy.mdx')).toBe(true);
    expect(
      provider.files.has('src/content/notes/reading-copy/books-copy.mdx'),
    ).toBe(true);
    expect(
      provider.files.has(
        'src/content/notes/reading-copy/books-copy/leaf-copy.mdx',
      ),
    ).toBe(true);
  });
});

describe('local content provider', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it('writes only inside the project root', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'oddava-content-'));
    const provider = createLocalContentProvider(tempDir);

    await provider.writeTextFile(
      'src/content/notes/example.mdx',
      'title: Example\nkind: note\nstatus: seed\n',
      'content: create notes/example',
    );

    const entries = await provider.listFiles('src/content/notes', 'mdx');
    expect(entries).toHaveLength(1);
    await expect(
      provider.writeTextFile('../bad.yaml', '', 'bad'),
    ).rejects.toThrow('Unsafe content path.');
  });

  it('returns a conflict response when a local edit uses a stale revision', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'oddava-content-'));
    const provider = createLocalContentProvider(tempDir);

    await provider.writeTextFile(
      'src/content/notes/example.mdx',
      '---\ntitle: Example\nkind: note\nstatus: seed\ncreated: 2026-07-04\ndraft: false\n---\n\nBody\n',
      'content: create notes/example',
    );

    const response = await handleContentEntry(
      provider,
      'notes',
      'example',
      jsonRequest('PUT', {
        fields: {
          title: 'Updated',
          kind: 'note',
          status: 'seed',
          created: '2026-07-04',
          draft: false,
        },
        body: 'Updated body',
        revision: 'local:stale',
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'revision_conflict',
    });
  });
});
