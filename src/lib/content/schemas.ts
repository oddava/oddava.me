import { z } from 'astro/zod';
import { isNoteIcon } from './noteIcon';

// The body is the source of truth; ordering and a file icon are optional metadata.
// Keep legacy titles available to redirect routes and migration tooling.
export const noteDataSchema = z.object({
  title: z.string().optional(),
  icon: z
    .string()
    .refine(isNoteIcon, 'Choose an emoji or upload an icon image.')
    .optional(),
  order: z.number().int().optional(),
  updated: z.coerce
    .date()
    .transform((value) => value.toISOString())
    .optional(),
});
