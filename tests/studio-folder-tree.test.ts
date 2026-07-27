import { h } from 'preact';
import { render } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { ContentEntryListItem, ContentFolder } from '../src/lib/contracts';
import StudioFolderTree from '../src/components/admin/StudioFolderTree';

// A first paint of the explorer, rendered the way the island is on the server.
// Effects do not run here, so this covers markup and the pure derivation behind
// it: which rows exist, which one row is tabbable, what a search leaves.

function entry(
  id: string,
  folder = '',
  extra: Partial<ContentEntryListItem> = {},
): ContentEntryListItem {
  return {
    id,
    title: extra.title ?? id.replaceAll('-', ' '),
    folder,
    path: [folder, `${id}.md`].filter(Boolean).join('/'),
    href: `/notes/${[folder, id].filter(Boolean).join('/')}`,
    revision: 'r1',
    ...extra,
  };
}

function folder(id: string, extra: Partial<ContentFolder> = {}): ContentFolder {
  const segments = id.split('/');
  return {
    id,
    name: segments[segments.length - 1] ?? id,
    parentId: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
    depth: segments.length - 1,
    noteCount: 0,
    totalNoteCount: 0,
    ...extra,
  };
}

const NOOP = () => undefined;
const OK = async () => true;

function draw(overrides: Record<string, unknown> = {}): string {
  return render(
    h(StudioFolderTree, {
      folders: [],
      entries: [],
      query: '',
      currentId: '',
      activeFolder: '',
      expandedFolders: new Set(['']),
      busyKey: null,
      sort: 'manual',
      onQueryChange: NOOP,
      onSortChange: NOOP,
      onCollapseAll: NOOP,
      onSetFolderExpansion: NOOP,
      onRefresh: async () => undefined,
      onRequestClose: NOOP,
      onNotice: NOOP,
      onToggleFolder: NOOP,
      onSelectFolder: NOOP,
      onEditEntry: NOOP,
      onOpenToSide: NOOP,
      onOpenFolder: OK,
      onCreateEntry: OK,
      onCreateFolder: OK,
      onRenameEntry: OK,
      onRenameFolder: OK,
      onDuplicateEntry: OK,
      onDuplicateFolder: OK,
      onDeleteEntry: OK,
      onDeleteFolder: OK,
      onMoveEntry: OK,
      onMoveFolder: OK,
      onDropItem: OK,
      onBulkMove: OK,
      onBulkDelete: OK,
      ...overrides,
      // The prop bag is assembled from a loose override map; the component's
      // own signature is what `pnpm run check` holds to account.
    } as never),
  );
}

function treeKeys(html: string): string[] {
  return [...html.matchAll(/data-tree-key="([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

const LIBRARY = {
  folders: [folder('work', { totalNoteCount: 2 }), folder('work/2024')],
  entries: [
    entry('index'),
    entry('work'),
    entry('errands', '', { title: 'Errands' }),
    entry('roadmap', 'work/2024', { title: 'Roadmap' }),
  ],
};

describe('StudioFolderTree markup', () => {
  it('is a multi-selectable tree whose list items carry no role of their own', () => {
    const html = draw(LIBRARY);

    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-multiselectable="true"');
    // APG: the li is scaffolding; the row inside it is the tree item.
    expect(html).toContain('<li role="none" class="studio-tree-item">');
  });

  it('offers exactly one tab stop, so Tab crosses the tree instead of walking it', () => {
    const html = draw({
      ...LIBRARY,
      expandedFolders: new Set(['', 'work', 'work/2024']),
    });

    expect([...html.matchAll(/tabindex="0"/g)]).toHaveLength(1);
    expect(html).toContain('data-tree-key="root" tabindex="0"');
    expect(treeKeys(html).length).toBeGreaterThan(1);
  });

  it('stops at a collapsed folder and walks into an expanded one', () => {
    expect(
      treeKeys(draw({ ...LIBRARY, expandedFolders: new Set(['']) })),
    ).toEqual(['root', 'entry:errands', 'folder:work']);

    expect(
      treeKeys(
        draw({
          ...LIBRARY,
          expandedFolders: new Set(['', 'work', 'work/2024']),
        }),
      ),
    ).toEqual([
      'root',
      'entry:errands',
      'folder:work',
      'folder:work/2024',
      'entry:roadmap',
    ]);
  });

  it('counts the rows the tree can show, not the entries behind them', () => {
    // Four entries and two folders, but the root index and the folder page are
    // part of a row rather than rows of their own: 2 folders + 2 notes.
    expect(draw(LIBRARY)).toContain('title="4 items"');
  });

  it('shows a collapsed folder what it is holding', () => {
    const html = draw({ ...LIBRARY, expandedFolders: new Set(['']) });

    expect(html).toContain('studio-tree-row__count');
    expect(html).toContain('2 notes');
  });

  it('drops the count once the folder is open and speaks for itself', () => {
    const html = draw({
      ...LIBRARY,
      expandedFolders: new Set(['', 'work']),
    });

    expect(html).not.toContain('studio-tree-row__count');
  });

  it('marks the open file as current without calling it selected', () => {
    const html = draw({
      ...LIBRARY,
      expandedFolders: new Set(['']),
      currentId: 'errands',
    });

    expect(html).toMatch(
      /data-tree-key="entry:errands"[^>]*aria-current="true"[^>]*class="[^"]*is-active/,
    );
    // The open file is "current", not "selected": selection is the multi-pick.
    expect(html).not.toContain('aria-selected="true"');
  });
});

describe('StudioFolderTree search', () => {
  it('reveals a match through folders that are still collapsed', () => {
    const html = draw({
      ...LIBRARY,
      expandedFolders: new Set([]),
      query: 'roadmap',
    });

    expect(treeKeys(html)).toEqual([
      'root',
      'folder:work',
      'folder:work/2024',
      'entry:roadmap',
    ]);
    expect(html).toContain('1 found');
  });

  it('finds a note by its title and marks what matched', () => {
    const html = draw({ ...LIBRARY, query: 'errand' });

    expect(treeKeys(html)).toEqual(['root', 'entry:errands']);
    expect(html).toContain('<mark>errand</mark>');
  });

  it('shows the path under each hit so two same-named files are telling apart', () => {
    expect(draw({ ...LIBRARY, query: 'roadmap' })).toContain(
      '<small>work/2024/roadmap.md</small>',
    );
  });

  it('says so when nothing matches, instead of going blank', () => {
    const html = draw({ ...LIBRARY, query: 'nothing-like-this' });

    expect(treeKeys(html)).toEqual(['root']);
    expect(html).toContain('studio-tree-empty');
    expect(html).toContain('Clear search');
  });

  it('offers a way out of the query it is filtering by', () => {
    expect(draw({ ...LIBRARY, query: 'roadmap' })).toContain(
      'studio-search__clear',
    );
    expect(draw(LIBRARY)).not.toContain('studio-search__clear');
  });
});

describe('StudioFolderTree empty library', () => {
  it('invites a first file rather than reporting an empty folder', () => {
    const html = draw();

    expect(html).toContain('No files yet.');
    expect(html).toContain('New file');
  });

  it('stays quiet when the root is merely collapsed', () => {
    const html = draw({ ...LIBRARY, expandedFolders: new Set([]) });

    expect(html).not.toContain('studio-tree-empty');
    expect(treeKeys(html)).toEqual(['root']);
  });
});
