import { describe, expect, it } from 'vitest';
import {
  bodyProvidesTitleHeading,
  buildWikiLinkHrefLookup,
  deriveSummary,
  deriveTitle,
  folderTitle,
  gardenSlug,
  getNoteTags,
  noteFolderFromSourceId,
  noteHrefFromSourceId,
  noteIdFromSourceId,
  noteParentIdFromSourceId,
  notePathFromSourceId,
  uniqueNoteLeafRedirects,
} from '../src/lib/garden/utils';
import {
  createLandscapeLayout,
  landscapePlaceBounds,
  landscapeRoutePath,
} from '../src/lib/garden/landscape-layout';

describe('notes helpers', () => {
  it('creates stable slugs for wiki links and aliases', () => {
    expect(gardenSlug('The Beginning After the End: Early Years')).toBe(
      'the-beginning-after-the-end-early-years',
    );
    expect(gardenSlug('  this website  ')).toBe('this-website');
  });

  it('resolves exact wiki paths and only unambiguous shorthand', () => {
    const lookup = buildWikiLinkHrefLookup([
      { id: 'reading/books', title: 'Books', href: '/notes/reading/books' },
      { id: 'projects/books', title: 'Books', href: '/notes/projects/books' },
      { id: 'books', title: 'Root books', href: '/notes/books' },
    ]);

    expect(lookup.get('reading/books')).toBe('/notes/reading/books');
    expect(lookup.get('projects/books')).toBe('/notes/projects/books');
    expect(lookup.get('books')).toBe('/notes/books');
    expect(lookup.has('root-books')).toBe(true);
  });

  it('keeps note identities stable inside nested folders', () => {
    expect(noteIdFromSourceId('reading/books/atomic-habits')).toBe(
      'atomic-habits',
    );
    expect(noteFolderFromSourceId('reading/books/atomic-habits')).toBe(
      'reading/books',
    );
    expect(folderTitle('reading/books-to-keep')).toBe('Books To Keep');
  });

  it('omits ambiguous bare-slug compatibility redirects', () => {
    expect(
      uniqueNoteLeafRedirects([
        { id: 'index' },
        { id: 'reading/books' },
        { id: 'projects/books' },
        { id: 'journal/entry' },
      ]),
    ).toEqual([{ slug: 'entry', redirectTo: '/notes/journal/entry' }]);
  });

  it('maps document paths onto the notes hierarchy', () => {
    expect(notePathFromSourceId('index')).toBe('');
    expect(noteHrefFromSourceId('index')).toBe('/notes');
    expect(noteHrefFromSourceId('reading/books/atomic-habits')).toBe(
      '/notes/reading/books/atomic-habits',
    );
    expect(noteParentIdFromSourceId('reading')).toBe('index');
    expect(noteParentIdFromSourceId('reading/books')).toBe('reading');
  });

  it('reads tags from inline hashtags in the body', () => {
    const note = { body: 'A note about #systems and #Software.' };
    expect(getNoteTags(note)).toEqual(['software', 'systems']);
  });

  it('takes the title from the first heading, or the file name', () => {
    expect(
      deriveTitle('# Why I keep notes\n\nBecause I forget.', 'notes'),
    ).toBe('Why I keep notes');
    expect(deriveTitle('## A quieter start', 'notes')).toBe('A quieter start');
    expect(deriveTitle('Just a paragraph, no heading.', 'atomic-habits')).toBe(
      'Atomic Habits',
    );
    expect(deriveTitle('# A [linked](https://x.com) title', 'x')).toBe(
      'A linked title',
    );
  });

  it('knows when a body opens with its own h1', () => {
    expect(bodyProvidesTitleHeading('# Title\n\nBody.')).toBe(true);
    expect(bodyProvidesTitleHeading('## A quieter start')).toBe(false);
    expect(bodyProvidesTitleHeading('\n\n# After blank lines')).toBe(true);
    expect(bodyProvidesTitleHeading('Just a paragraph, no headings.')).toBe(
      false,
    );
  });

  it('uses the first real paragraph as the summary', () => {
    expect(
      deriveSummary('# Heading\n\nThe first thing I actually wrote.'),
    ).toBe('The first thing I actually wrote.');
    expect(deriveSummary('# Only a heading')).toBe('');
    expect(deriveSummary('![cover](/x.png)\n\nAfter the image.')).toBe(
      'After the image.',
    );
  });

  it('turns filesystem paths into stable nested landscape regions', () => {
    const places = [
      {
        id: 'index',
        title: 'Notes',
        parentId: null,
        childIds: ['reading', 'journal'],
      },
      {
        id: 'reading',
        title: 'Reading',
        parentId: 'index',
        childIds: ['reading/books'],
      },
      {
        id: 'reading/books',
        title: 'Books',
        parentId: 'reading',
        childIds: ['reading/books/sleep'],
      },
      {
        id: 'reading/books/sleep',
        title: 'Why We Sleep',
        parentId: 'reading/books',
        childIds: [],
      },
      {
        id: 'journal',
        title: 'Journal',
        parentId: 'index',
        childIds: [],
      },
    ];

    const first = createLandscapeLayout(places);
    const second = createLandscapeLayout(places);

    expect(second).toEqual(first);
    expect(first.regions.map((region) => region.id)).toEqual([
      '',
      'reading',
      'reading/books',
    ]);
    expect(
      first.regions.find((region) => region.id === 'reading/books')?.parentId,
    ).toBe('reading');
    expect(
      first.places.find((place) => place.id === 'reading/books/sleep')
        ?.regionId,
    ).toBe('reading/books');

    const sleep = first.places.find(
      (place) => place.id === 'reading/books/sleep',
    )!;
    const journal = first.places.find((place) => place.id === 'journal')!;
    expect(landscapeRoutePath(first, sleep, journal, 'reference')).toMatch(
      /^M .* C /,
    );

    const moved = createLandscapeLayout(
      places.map((place) =>
        place.id === 'reading/books/sleep'
          ? { ...place, id: 'reading/essays/sleep' }
          : place,
      ),
    );
    expect(moved.regions.some((region) => region.id === 'reading/essays')).toBe(
      true,
    );
  });

  it('reserves room for note typography inside dense regions', () => {
    const layout = createLandscapeLayout([
      {
        id: 'index',
        title: 'Notes',
        parentId: null,
        childIds: ['library'],
      },
      {
        id: 'library',
        title: 'Library',
        parentId: 'index',
        childIds: ['library/a', 'library/b', 'library/c', 'library/d'],
      },
      {
        id: 'library/a',
        title: 'The Beginning After the End: Early Years',
        parentId: 'library',
        childIds: [],
      },
      {
        id: 'library/b',
        title: "Omniscient Reader's Viewpoint",
        parentId: 'library',
        childIds: [],
      },
      {
        id: 'library/c',
        title: 'A Field Guide to Getting Lost',
        parentId: 'library',
        childIds: [],
      },
      {
        id: 'library/d',
        title: 'The Left Hand of Darkness',
        parentId: 'library',
        childIds: [],
      },
    ]);
    const leaves = layout.places.filter(
      (place) => place.regionId === 'library' && !place.isRegionAnchor,
    );

    for (let leftIndex = 0; leftIndex < leaves.length; leftIndex += 1) {
      const left = landscapePlaceBounds(leaves[leftIndex]!, 12);
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < leaves.length;
        rightIndex += 1
      ) {
        const right = landscapePlaceBounds(leaves[rightIndex]!, 12);
        const overlaps = !(
          left.right <= right.left ||
          left.left >= right.right ||
          left.bottom <= right.top ||
          left.top >= right.bottom
        );
        expect(overlaps).toBe(false);
      }
    }
  });
});
