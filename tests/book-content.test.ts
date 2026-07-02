import { describe, expect, it } from 'vitest';
import { toBookCards, type BookEntry } from '../src/lib/content/books';

type TestBookData = {
  title: string;
  coverImage?: string | null;
  href?: string | null;
  order?: number | null;
};

const bookEntry = (id: string, data: TestBookData): BookEntry =>
  ({
    id,
    data,
  }) as BookEntry;

describe('book content helpers', () => {
  it('maps content book entries to display-ready cards', () => {
    expect(
      toBookCards([
        bookEntry('first-book', {
          title: 'First book',
          coverImage: '/images/books/first-book.jpg',
          href: 'https://example.com/first-book',
        }),
        bookEntry('second-book', {
          title: 'Second book',
          coverImage: '/images/books/second-book.jpg',
          href: '',
        }),
      ]),
    ).toEqual([
      {
        coverImage: '/images/books/first-book.jpg',
        href: 'https://example.com/first-book',
        title: 'First book',
      },
      {
        coverImage: '/images/books/second-book.jpg',
        href: '#second-book',
        title: 'Second book',
      },
    ]);
  });

  it('filters entries that cannot render a cover image', () => {
    expect(
      toBookCards([
        bookEntry('missing-cover', {
          title: 'Missing cover',
          coverImage: null,
        }),
      ]),
    ).toEqual([]);
  });

  it('sorts entries by order before title', () => {
    expect(
      toBookCards([
        bookEntry('z-book', {
          title: 'Z Book',
          coverImage: '/images/books/z-book.jpg',
          order: 2,
        }),
        bookEntry('a-book', {
          title: 'A Book',
          coverImage: '/images/books/a-book.jpg',
        }),
        bookEntry('b-book', {
          title: 'B Book',
          coverImage: '/images/books/b-book.jpg',
          order: 1,
        }),
      ]).map((card) => card.title),
    ).toEqual(['B Book', 'Z Book', 'A Book']);
  });
});
