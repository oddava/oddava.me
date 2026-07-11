import { noteDataSchema } from '../../content/schemas';
import type { ContentCollectionDefinition, ContentCollectionId } from './types';

export const CONTENT_COLLECTIONS = {
  notes: {
    id: 'notes',
    label: 'Notes',
    singularLabel: 'Note',
    sourceDir: 'src/content/notes',
    extension: 'mdx',
    format: 'mdx',
    body: true,
    mediaDir: 'public/images/notes',
    mediaPublicPath: '/images/notes',
    groupMediaByEntry: true,
    reorderable: true,
    orderField: 'order',
    schema: noteDataSchema,
    routePattern: '/notes/:id',
    indexRoute: '/notes',
    supportsDrafts: true,
    supportsBlocks: true,
    supportsFolders: true,
    // The body is the whole page. Nothing else is a "field" — the title comes
    // from whatever heading you write, and where the file lives is its place in
    // the garden.
    surfaces: [{ id: 'body', label: 'Note body', kind: 'blocks' }],
    templates: [
      {
        id: 'garden-note',
        label: 'Blank note',
        description: 'An empty page. Write it however you like.',
        fields: {},
        blocks: [
          {
            id: 'opening',
            type: 'paragraph',
            value: '',
          },
        ],
      },
    ],
    fields: [
      { name: 'draft', label: 'Draft', type: 'boolean' },
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
