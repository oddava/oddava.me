import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  handleContentCollection,
  handleContentEntry,
  handleContentMedia,
  handleContentReorder,
} from '../src/lib/server/content/api';
import { createLocalContentProvider } from '../src/lib/server/content/local-provider';
import {
  assertSafeRepositoryPath,
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

  async writeTextFile(
    path: string,
    content: string,
    message: string,
  ): Promise<ContentWriteResult> {
    const revision = `rev-${++this.revision}`;
    this.files.set(path, { path, content, revision });
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
  new Request('https://oddava.me/api/admin/content/blog', {
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
    expect(isValidSlug('../bad')).toBe(false);
    expect(() => assertSafeRepositoryPath('../bad')).toThrow(
      'Unsafe content path.',
    );
    expect(sanitizeFilename('My Cover.PNG')).toMatch(/^my-cover-.+\.png$/);
  });
});

describe('content admin API core', () => {
  it('creates, updates, lists, and deletes entries', async () => {
    const provider = new MemoryContentProvider();

    const createResponse = await handleContentCollection(
      provider,
      'blog',
      jsonRequest('POST', {
        slug: 'hello-world',
        fields: {
          title: 'Hello world',
          date: '2026-07-03',
          draft: false,
        },
        body: 'Body copy',
      }),
    );

    expect(createResponse.status).toBe(201);
    expect(
      provider.files.get('src/content/blog/hello-world.mdx')?.content,
    ).toContain('Body copy');

    const duplicateResponse = await handleContentCollection(
      provider,
      'blog',
      jsonRequest('POST', {
        slug: 'hello-world',
        fields: { title: 'Hello', date: '2026-07-03' },
      }),
    );
    expect(duplicateResponse.status).toBe(409);

    const listResponse = await handleContentCollection(
      provider,
      'blog',
      new Request('https://oddava.me/api/admin/content/blog'),
    );
    await expect(listResponse.json()).resolves.toMatchObject({
      entries: [{ id: 'hello-world', title: 'Hello world' }],
    });

    const updateResponse = await handleContentEntry(
      provider,
      'blog',
      'hello-world',
      jsonRequest('PUT', {
        fields: {
          title: 'Updated',
          date: '2026-07-04',
          draft: true,
        },
        body: 'Updated body',
      }),
    );
    expect(updateResponse.status).toBe(200);
    expect(
      provider.files.get('src/content/blog/hello-world.mdx')?.content,
    ).toContain('Updated body');

    const deleteResponse = await handleContentEntry(
      provider,
      'blog',
      'hello-world',
      new Request('https://oddava.me/api/admin/content/blog/hello-world', {
        method: 'DELETE',
      }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(provider.files.has('src/content/blog/hello-world.mdx')).toBe(false);
  });

  it('returns field validation errors', async () => {
    const response = await handleContentCollection(
      new MemoryContentProvider(),
      'blog',
      jsonRequest('POST', {
        slug: 'invalid',
        fields: { title: 'Invalid', date: 'July 3' },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('accepts supported media uploads and rejects unsupported files', async () => {
    const provider = new MemoryContentProvider();
    const formData = new FormData();
    formData.set('collection', 'books');
    formData.set('entryId', 'my-book');
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
    expect(payload.media.url).toMatch(/^\/images\/books\/my-book\/cover-/);
    expect(provider.binaries.size).toBe(1);

    const invalid = new FormData();
    invalid.set('collection', 'books');
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

  it('reorders books sequentially by id list', async () => {
    const provider = new MemoryContentProvider();
    const bookIds = ['alpha', 'beta', 'gamma'];
    for (const [index, id] of bookIds.entries()) {
      await provider.writeTextFile(
        `src/content/books/${id}.yaml`,
        `title: ${id}\ncoverImage: /${id}.webp\norder: ${index}\n`,
        `content: create books/${id}`,
      );
    }

    const reorderResponse = await handleContentReorder(
      provider,
      'books',
      new Request('https://oddava.me/api/admin/content/books/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['gamma', 'alpha', 'beta'] }),
      }),
    );

    expect(reorderResponse.status).toBe(200);
    const payload = await reorderResponse.json();
    expect(payload.reordered).toEqual([
      { id: 'gamma', ok: true },
      { id: 'alpha', ok: true },
      { id: 'beta', ok: true },
    ]);

    const alpha = await provider.readFile('src/content/books/alpha.yaml');
    expect(alpha?.content).toContain('order: 1');
    const gamma = await provider.readFile('src/content/books/gamma.yaml');
    expect(gamma?.content).toContain('order: 0');

    const blogReorder = await handleContentReorder(
      provider,
      'blog',
      new Request('https://oddava.me/api/admin/content/blog/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['x'] }),
      }),
    );
    expect(blogReorder.status).toBe(400);
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
      'src/content/books/example.yaml',
      'title: Example\ncoverImage: /cover.webp\n',
      'content: create books/example',
    );

    const entries = await provider.listFiles('src/content/books', 'yaml');
    expect(entries).toHaveLength(1);
    await expect(
      provider.writeTextFile('../bad.yaml', '', 'bad'),
    ).rejects.toThrow('Unsafe content path.');
  });
});
