import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { render } from 'preact-render-to-string';
import KnowledgeLandscape, {
  type KnowledgePath,
  type KnowledgePlace,
} from '../src/components/garden/KnowledgeLandscape';
import { buildAffinityPaths, type GardenDocument } from '../src/lib/garden';

function buildSyntheticGarden(count: number): {
  places: KnowledgePlace[];
  paths: KnowledgePath[];
} {
  const folders = ['reading', 'projects', 'journal', 'essays', 'notes-sub'];
  const places: KnowledgePlace[] = [
    {
      id: 'index',
      title: 'notes',
      summary: 'the root',
      href: '/notes',
      parentId: null,
      childIds: folders.slice(),
      tags: [],
      linkCount: 0,
      localMapHref: null,
    },
  ];

  for (const folder of folders) {
    places.push({
      id: folder,
      title: folder,
      summary: '',
      href: `/notes/${folder}`,
      parentId: 'index',
      childIds: [],
      tags: [],
      linkCount: 0,
      localMapHref: null,
    });
  }

  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const folder = folders[index % folders.length]!;
    const id = `${folder}/note-${index}`;
    ids.push(id);
    places.push({
      id,
      title: `Note ${index} with a moderately long descriptive title`,
      summary: `summary for note ${index}`,
      href: `/notes/${id}`,
      parentId: folder,
      childIds: [],
      tags: [`tag-${index % 5}`, `topic-${index % 3}`, `shared`],
      linkCount: 0,
      localMapHref: null,
    });
  }

  for (const folder of folders) {
    const childIds = ids.filter((id) => id.startsWith(`${folder}/`));
    places.find((place) => place.id === folder)!.childIds = childIds;
  }

  const paths: KnowledgePath[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const sourceId = ids[index]!;
    const targetId = ids[(index + 7) % ids.length]!;
    if (sourceId !== targetId) {
      paths.push({ sourceId, targetId, kind: 'reference' });
    }
  }
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      if (left % 5 === right % 5 && left % 3 === right % 3) {
        paths.push({
          sourceId: ids[left]!,
          targetId: ids[right]!,
          kind: 'affinity',
        });
      }
    }
  }

  return { places, paths };
}

function fakeDocument(
  id: string,
  tags: string[],
  outbound: GardenDocument['outbound'] = [],
): GardenDocument {
  return {
    id,
    sourceId: id,
    path: id,
    parentId: id === 'index' ? null : 'index',
    childIds: [],
    href: `/notes/${id}`,
    title: id,
    summary: '',
    updated: '',
    data: {},
    body: '',
    outbound,
    backlinks: [],
    tags,
  };
}

describe('KnowledgeLandscape render', () => {
  it('renders without throwing or hanging for a realistic garden', () => {
    const { places, paths } = buildSyntheticGarden(180);
    const html = render(h(KnowledgeLandscape, { places, paths })) as string;

    expect(html).toContain('knowledge-landscape');
    expect(html).toContain('<svg');
    expect(html).toContain('landscape-place-');
  });

  it('renders the empty state when there are no places', () => {
    const html = render(
      h(KnowledgeLandscape, { places: [], paths: [] }),
    ) as string;

    expect(html).toContain('Nothing has settled here yet.');
  });
});

describe('buildAffinityPaths', () => {
  it('ignores generic tags shared by most of the garden', () => {
    // Before the fix, two tags carried by every note joined every pair — an
    // O(n²) complete graph that only /notes/graph draws, freezing the page.
    const documents: GardenDocument[] = [];
    for (let i = 0; i < 120; i += 1) {
      documents.push(fakeDocument(`note-${i}`, ['systems', 'software']));
    }

    expect(buildAffinityPaths(documents)).toEqual([]);
  });

  it('still links notes that share specific rare themes', () => {
    const documents: GardenDocument[] = [
      fakeDocument('a', ['shape-note', 'paper-creature', 'systems']),
      fakeDocument('b', ['shape-note', 'paper-creature']),
      // Shares only one specific theme — not enough to draw an edge.
      fakeDocument('c', ['shape-note', 'unrelated']),
      // Shares no specific themes.
      fakeDocument('d', ['unrelated', 'misc']),
    ];

    const edges = buildAffinityPaths(documents);
    expect(edges).toEqual([{ sourceId: 'a', targetId: 'b' }]);
  });

  it('caps the total edge count for a pathological corpus', () => {
    // Each of 200 notes shares a private pair of specific tags with every other
    // note — a complete graph of ~20k specific-theme edges. The cap keeps the
    // graph renderable; the generic filter alone cannot bound this shape.
    const documents: GardenDocument[] = [];
    for (let i = 0; i < 200; i += 1) {
      documents.push(fakeDocument(`note-${i}`, ['theme-a', 'theme-b']));
    }

    expect(buildAffinityPaths(documents).length).toBeLessThanOrEqual(1500);
  });
});
