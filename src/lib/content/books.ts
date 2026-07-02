import type { CollectionEntry } from 'astro:content';

export type BookEntry = Pick<CollectionEntry<'books'>, 'data' | 'id'>;

export type BookCard = {
  coverImage: string;
  href: string;
  title: string;
};

export function toBookCards(entries: BookEntry[]): BookCard[] {
  return entries
    .toSorted((left, right) => {
      const orderDifference =
        (left.data.order ?? Number.MAX_SAFE_INTEGER) -
        (right.data.order ?? Number.MAX_SAFE_INTEGER);

      if (orderDifference !== 0) return orderDifference;

      return left.data.title.localeCompare(right.data.title);
    })
    .flatMap((book) => {
      if (!book.data.coverImage) return [];

      return {
        coverImage: book.data.coverImage,
        href: book.data.href || `#${book.id}`,
        title: book.data.title,
      };
    });
}

export async function getBookCards(): Promise<BookCard[]> {
  const { getCollection } = await import('astro:content');
  return toBookCards(await getCollection('books'));
}
