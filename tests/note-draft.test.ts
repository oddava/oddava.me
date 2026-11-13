import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isDraftNote, parseDraftFlag } from '../src/lib/content/noteDraft';
import { noteDataSchema } from '../src/lib/content/schemas';
import { buildGardenIndex } from '../src/lib/garden/build';
import { deriveNoteGraph } from '../src/lib/garden/graph';
import { searchNotes } from '../src/lib/garden/search';
import type { NoteSource } from '../src/lib/garden/types';
import { hasDrafts, publicNoteSources } from '../src/lib/garden/visibility';
import { toDetail } from '../src/lib/server/content/documents';
import { NOTES_COLLECTION } from '../src/lib/server/content/registry';
import {
  parseContentDocument,
  serializeContentDocument,
} from '../src/lib/server/content/serializers';

function source(id: string, body: string, draft = false): NoteSource {
  return {
    id,
    data: draft ? { draft: true } : {},
    body,
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

const sources = [
  source('index', '# notes\n\nSee [[reading]] and [[secret-plan]].'),
  source('reading', '# reading\n\nMentions [[secret-plan]] #books #craft'),
  source('secret-plan', '# secret plan\n\nUnreleased #books #craft', true),
  source('secret-plan/child', '# child\n\nInside a draft.'),
];

describe('draft flag', () => {
  it('only a true flag (or the string "true") hides a note', () => {
    expect(parseDraftFlag(true)).toBe(true);
    expect(parseDraftFlag(' True ')).toBe(true);
    for (const value of [false, 'false', 'yes', 1, null, undefined, {}]) {
      expect(parseDraftFlag(value)).toBe(false);
    }
    expect(isDraftNote({ draft: true })).toBe(true);
    expect(isDraftNote({})).toBe(false);
  });

  it('normalises to a bare true so publishing removes the key', () => {
    expect(noteDataSchema.parse({ draft: true })).toEqual({ draft: true });
    expect(noteDataSchema.parse({ draft: 'true' })).toEqual({ draft: true });
    expect(noteDataSchema.parse({ draft: false })).toEqual({});
    expect(noteDataSchema.parse({ draft: 'maybe' })).toEqual({});
    expect(noteDataSchema.parse({})).toEqual({});
  });

  it('round trips through stored frontmatter and the Studio list item', () => {
    const content = serializeContentDocument(
      noteDataSchema.parse({ draft: true }) as Record<string, unknown>,
      '# Half written',
    );
    expect(content).toContain('draft: true');
    expect(parseContentDocument(content).fields.draft).toBe(true);

    const detail = toDetail(NOTES_COLLECTION, {
      path: 'src/content/notes/half-written.md',
      content,
      revision: 'r1',
    });
    expect(detail.draft).toBe(true);
    expect(detail.fields.draft).toBe(true);

    const published = toDetail(NOTES_COLLECTION, {
      path: 'src/content/notes/done.md',
      content: serializeContentDocument({}, '# Done'),
      revision: 'r2',
    });
    expect('draft' in published).toBe(false);
  });
});

describe('public visibility', () => {
  it('drops drafts from the sources but never the Notes root', () => {
    expect(publicNoteSources(sources).map((entry) => entry.id)).toEqual([
      'index',
      'reading',
      'secret-plan/child',
    ]);
    const draftRoot = [source('index', '# notes', true), sources[1]!];
    expect(publicNoteSources(draftRoot).map((entry) => entry.id)).toEqual([
      'index',
      'reading',
    ]);
    expect(hasDrafts(draftRoot)).toBe(false);
    expect(hasDrafts(sources)).toBe(true);
  });

  it('leaves a draft out of every surface derived from the index', () => {
    const index = buildGardenIndex(publicNoteSources(sources));
    const ids = index.documents.map((document) => document.id);
    expect(ids).not.toContain('secret-plan');

    // Hierarchy: the draft's child re-attaches to the root rather than dangling.
    expect(index.root.childIds).not.toContain('secret-plan');
    expect(index.byId.get('secret-plan/child')?.parentId).toBe('index');

    // Backlinks and outbound links: the draft is neither a source nor a target.
    expect(index.byId.get('reading')?.backlinks).toEqual(['index']);
    expect(
      index.root.outbound.find((link) => link.target === 'secret-plan')
        ?.resolvedId,
    ).toBeUndefined();
    expect(index.wikiLinkHrefs.has('secret-plan')).toBe(false);

    // Tags and affinity edges only see public notes.
    expect(index.affinityPaths).toEqual([]);

    // Search and the graph.
    expect(searchNotes(index.documents, 'unreleased', 8)).toEqual([]);
    expect(deriveNoteGraph(index).nodes.map((node) => node.id)).not.toContain(
      'secret-plan',
    );
  });

  it('keeps the draft in an index built from every source', () => {
    const index = buildGardenIndex(sources);
    expect(index.byId.get('secret-plan')?.data.draft).toBe(true);
    expect(index.byId.get('secret-plan')?.backlinks).toEqual([
      'index',
      'reading',
    ]);
  });
});

const runtime = vi.hoisted(() => ({
  version: 1,
  files: [] as { sourceId: string; content: string; updatedAt: string }[],
}));

vi.mock('../src/lib/server/content/redis-store', () => ({
  readRedisNoteFiles: async () => structuredClone(runtime.files),
  readStableContentVersion: async () => String(runtime.version),
  readRetiredNoteIndex: async () => ({
    redirects: new Map(),
    tombstones: new Set(),
  }),
}));

describe('garden runtime audiences', () => {
  beforeEach(() => {
    runtime.version = 1;
    runtime.files = [
      { sourceId: 'index', content: '# notes', updatedAt: '2026-01-01' },
      {
        sourceId: 'wip',
        content: '---\ndraft: true\n---\n\n# wip\n\nnot yet',
        updatedAt: '2026-01-02',
      },
      {
        // An unrelated bad field must not turn the draft into a public note.
        sourceId: 'typo',
        content: '---\ndraft: true\norder: 1.5\n---\n\n# typo',
        updatedAt: '2026-01-03',
      },
      { sourceId: 'live', content: '# live', updatedAt: '2026-01-04' },
    ];
    vi.resetModules();
  });

  it('serves visitors the public index and the owner the full one', async () => {
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    const publicIds = (await getGardenIndex()).documents.map((d) => d.id);
    expect(publicIds.toSorted()).toEqual(['index', 'live']);

    const ownerIds = (await getGardenIndex({ includeDrafts: true })).documents
      .map((d) => d.id)
      .toSorted();
    expect(ownerIds).toEqual(['index', 'live', 'typo', 'wip']);
  });

  it('shares one index when nothing is a draft', async () => {
    runtime.files = runtime.files.filter(
      (file) => !file.content.includes('draft'),
    );
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    expect(await getGardenIndex()).toBe(
      await getGardenIndex({ includeDrafts: true }),
    );
  });

  it('follows the content version when a draft is published', async () => {
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    expect((await getGardenIndex()).byId.has('wip')).toBe(false);

    runtime.files = runtime.files.map((file) =>
      file.sourceId === 'wip'
        ? { ...file, content: '# wip\n\nnow live' }
        : file,
    );
    runtime.version = 2;
    expect((await getGardenIndex()).byId.has('wip')).toBe(true);
  });
});
