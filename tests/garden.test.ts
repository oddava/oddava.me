import { describe, expect, it } from 'vitest';
import {
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
} from '../src/lib/garden/utils';

describe('notes helpers', () => {
  it('creates stable slugs for wiki links and aliases', () => {
    expect(gardenSlug('The Beginning After the End: Early Years')).toBe(
      'the-beginning-after-the-end-early-years',
    );
    expect(gardenSlug('  this website  ')).toBe('this-website');
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

  it('uses the first real paragraph as the summary', () => {
    expect(
      deriveSummary('# Heading\n\nThe first thing I actually wrote.'),
    ).toBe('The first thing I actually wrote.');
    expect(deriveSummary('# Only a heading')).toBe('');
    expect(deriveSummary('![cover](/x.png)\n\nAfter the image.')).toBe(
      'After the image.',
    );
  });
});
