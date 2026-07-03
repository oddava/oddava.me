import {
  blogDataSchema,
  bookDataSchema,
  projectDataSchema,
} from '../../content/schemas';
import type { ContentCollectionDefinition, ContentCollectionId } from './types';

export const CONTENT_COLLECTIONS = {
  blog: {
    id: 'blog',
    label: 'Blog',
    singularLabel: 'Post',
    sourceDir: 'src/content/blog',
    extension: 'mdx',
    format: 'mdx',
    body: true,
    mediaDir: 'public/images/blog',
    mediaPublicPath: '/images/blog',
    groupMediaByEntry: true,
    schema: blogDataSchema,
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'updated', label: 'Updated', type: 'date' },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        description: 'Short summary for archive and social cards.',
      },
      { name: 'draft', label: 'Draft', type: 'boolean' },
    ],
  },
  projects: {
    id: 'projects',
    label: 'Projects',
    singularLabel: 'Project',
    sourceDir: 'src/content/projects',
    extension: 'mdx',
    format: 'mdx',
    body: true,
    mediaDir: 'public/images/projects',
    mediaPublicPath: '/images/projects',
    groupMediaByEntry: true,
    schema: projectDataSchema,
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        required: true,
      },
      { name: 'tech', label: 'Tech stack', type: 'string-list' },
      { name: 'url', label: 'Live URL', type: 'url' },
      { name: 'repo', label: 'Repository URL', type: 'url' },
      { name: 'featured', label: 'Featured', type: 'boolean' },
    ],
  },
  books: {
    id: 'books',
    label: 'Books',
    singularLabel: 'Book',
    sourceDir: 'src/content/books',
    extension: 'yaml',
    format: 'yaml',
    body: false,
    mediaDir: 'public/images/books',
    mediaPublicPath: '/images/books',
    groupMediaByEntry: true,
    schema: bookDataSchema,
    reorderable: true,
    orderField: 'order',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      {
        name: 'coverImage',
        label: 'Cover image',
        type: 'image',
        required: true,
      },
      { name: 'href', label: 'Link', type: 'url' },
      { name: 'order', label: 'Order', type: 'integer', hidden: true },
    ],
  },
} satisfies Record<ContentCollectionId, ContentCollectionDefinition>;

export function getContentCollection(
  id: string | undefined,
): ContentCollectionDefinition | null {
  if (!id || !(id in CONTENT_COLLECTIONS)) return null;
  return CONTENT_COLLECTIONS[id as ContentCollectionId];
}

export function getContentCollections(): ContentCollectionDefinition[] {
  return Object.values(CONTENT_COLLECTIONS);
}
