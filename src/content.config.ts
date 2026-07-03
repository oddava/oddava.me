import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  blogDataSchema,
  bookDataSchema,
  projectDataSchema,
} from './lib/content/schemas';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: blogDataSchema,
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: projectDataSchema,
});

const books = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/books' }),
  schema: bookDataSchema,
});

export const collections = { blog, books, projects };
