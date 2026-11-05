import { noteDataSchema } from '../../content/schemas';
import { NOTES_ROUTE_PREFIX } from '../../notes-url';
import type { ContentCollectionDefinition } from './types';

export const NOTES_COLLECTION = {
  id: 'notes',
  label: 'Notes',
  singularLabel: 'Note',
  sourceDir: 'src/content/notes',
  extension: 'md',
  readExtensions: ['md'],
  mediaDir: 'public/images/notes',
  mediaPublicPath: '/images/notes',
  routePrefix: NOTES_ROUTE_PREFIX,
  orderField: 'order',
  schema: noteDataSchema,
} satisfies ContentCollectionDefinition;

export function getContentCollection(
  id: string | undefined,
): ContentCollectionDefinition | null {
  return id === NOTES_COLLECTION.id ? NOTES_COLLECTION : null;
}
