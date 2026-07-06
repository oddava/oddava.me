import { getCollection, type CollectionEntry } from 'astro:content';
import { sortEntriesByDateDesc } from './post-utils';

export type BlogPost = CollectionEntry<'blog'>;

export async function getPublishedPosts(): Promise<BlogPost[]> {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return sortEntriesByDateDesc(posts);
}

export async function getFeaturedPosts(): Promise<BlogPost[]> {
  const posts = await getCollection(
    'blog',
    ({ data }) => !data.draft && data.featured,
  );
  return sortEntriesByDateDesc(posts);
}
