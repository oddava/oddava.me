import { describe, expect, it } from 'vitest';
import {
  bodyProvidesTitleHeading,
  shouldShowNoteTitle,
  buildWikiLinkHrefLookup,
  deriveNoteSocialImage,
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

  it('does not create a heading for a cleared note', () => {
    expect(shouldShowNoteTitle('')).toBe(false);
    expect(shouldShowNoteTitle(' \n\t\n')).toBe(false);
    expect(shouldShowNoteTitle('# Authored title')).toBe(false);
    expect(shouldShowNoteTitle('A paragraph.')).toBe(true);
    expect(shouldShowNoteTitle('## A section')).toBe(true);
  });

  it('uses the first real paragraph as the summary', () => {
    expect(
      deriveSummary('# Heading\n\nThe first thing I actually wrote.'),
    ).toBe('The first thing I actually wrote.');
    expect(deriveSummary('# Only a heading')).toBe('');
    expect(deriveSummary('![cover](/x.png)\n\nAfter the image.')).toBe(
      'After the image.',
    );
    expect(
      deriveSummary(
        '<figure class="note-figure">\n<img src="/x.png" alt="cover">\n<figcaption>[[Cover note]]</figcaption>\n</figure>\n\nThe actual note content.',
      ),
    ).toBe('The actual note content.');
    expect(deriveSummary('<p>Plain <strong>HTML</strong> text.</p>')).toBe(
      'Plain HTML text.',
    );
  });

  it('uses the first public note image for social previews', () => {
    expect(
      deriveNoteSocialImage(
        '# Entry\n\n![A linked cover](/images/cover.webp)\n\nText.',
      ),
    ).toEqual({ src: '/images/cover.webp', alt: 'A linked cover' });

    expect(
      deriveNoteSocialImage(
        '<figure><img src="https://images.example/photo.jpg" alt="A photo"></figure>',
      ),
    ).toEqual({
      src: 'https://images.example/photo.jpg',
      alt: 'A photo',
    });

    expect(deriveNoteSocialImage('![private](data:image/png;base64,abc)')).toBe(
      undefined,
    );
  });
});
