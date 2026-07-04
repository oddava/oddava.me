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
    routePattern: '/blog/:id',
    indexRoute: '/blog',
    supportsDrafts: true,
    supportsBlocks: true,
    surfaces: [
      { id: 'title', label: 'Title', kind: 'field', fieldName: 'title' },
      {
        id: 'description',
        label: 'Description',
        kind: 'field',
        fieldName: 'description',
      },
      { id: 'body', label: 'Post body', kind: 'blocks' },
    ],
    templates: [
      {
        id: 'journal-note',
        label: 'Journal note',
        description: 'A short dated post with a simple opening paragraph.',
        fields: {
          title: 'Untitled note',
          date: new Date().toISOString().slice(0, 10),
          draft: true,
        },
        blocks: [
          {
            id: 'opening',
            type: 'paragraph',
            value: 'Start writing...',
          },
        ],
      },
    ],
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
    routePattern: '/projects/:id',
    indexRoute: '/projects',
    supportsDrafts: true,
    supportsBlocks: true,
    surfaces: [
      { id: 'title', label: 'Project name', kind: 'field', fieldName: 'title' },
      {
        id: 'description',
        label: 'Summary',
        kind: 'field',
        fieldName: 'description',
      },
      { id: 'body', label: 'Project story', kind: 'blocks' },
    ],
    templates: [
      {
        id: 'project-case-study',
        label: 'Project case study',
        description: 'A compact project page with stack, links, and story.',
        fields: {
          title: 'Untitled project',
          description: 'Short project summary',
          tech: [],
          featured: false,
        },
        blocks: [
          {
            id: 'overview',
            type: 'paragraph',
            value: 'What changed, who it helps, and why it matters.',
          },
        ],
      },
    ],
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
    routePattern: '/library#books',
    indexRoute: '/library',
    supportsDrafts: true,
    supportsBlocks: false,
    surfaces: [
      { id: 'title', label: 'Book title', kind: 'field', fieldName: 'title' },
      {
        id: 'coverImage',
        label: 'Cover image',
        kind: 'field',
        fieldName: 'coverImage',
      },
      { id: 'href', label: 'Book link', kind: 'field', fieldName: 'href' },
    ],
    templates: [
      {
        id: 'book-card',
        label: 'Book card',
        description: 'A library card with cover art and an optional link.',
        fields: {
          title: 'Untitled book',
          coverImage: '',
          href: '',
        },
        blocks: [],
      },
    ],
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
