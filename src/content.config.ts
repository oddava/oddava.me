import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { noteDataSchema } from './lib/content/schemas';

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: noteDataSchema,
});

export const collections = { notes };
