import { noteDataSchema } from '../../content/schemas';
import type { ContentCollectionDefinition } from './types';

export const NOTES_COLLECTION = {
  id: 'notes',
  label: 'Notes',
  singularLabel: 'Note',
  sourceDir: 'src/content/notes',
  extension: 'md',
  readExtensions: ['md', 'mdx'],
  mediaDir: 'public/images/notes',
  mediaPublicPath: '/images/notes',
  routePrefix: '/notes',
  orderField: 'order',
  schema: noteDataSchema,
} satisfies ContentCollectionDefinition;

export function getContentCollection(
  id: string | undefined,
): ContentCollectionDefinition | null {
  return id === NOTES_COLLECTION.id ? NOTES_COLLECTION : null;
}
