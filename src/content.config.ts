import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const safeExternalUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'https:' || protocol === 'http:';
}, 'URL must use http or https.');

const optionalExternalUrl = z.preprocess(
  (value) => value || undefined,
  safeExternalUrl.optional(),
);

const optionalInteger = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.number().int().optional(),
);

const blog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.string(),
    updated: z.coerce.string().optional(),
    description: z.string().optional(),
    draft: z.boolean().optional().default(false),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tech: z.array(z.string()).optional().default([]),
    url: safeExternalUrl.optional(),
    repo: safeExternalUrl.optional(),
    featured: z.boolean().optional().default(false),
  }),
});

const books = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/books' }),
  schema: z.object({
    title: z.string(),
    coverImage: z.string(),
    href: optionalExternalUrl,
    order: optionalInteger,
  }),
});

export const collections = { blog, books, projects };
