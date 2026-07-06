import { z } from 'astro/zod';

export const safeExternalUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'https:' || protocol === 'http:';
}, 'URL must use http or https.');

export const optionalExternalUrl = z.preprocess(
  (value) => value || undefined,
  safeExternalUrl.optional(),
);

export const optionalInteger = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.number().int().optional(),
);

export const dateString = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD.'),
);

export const blogDataSchema = z.object({
  title: z.string().min(1, 'Title is required.'),
  date: dateString,
  updated: dateString.optional(),
  description: z.string().optional(),
  draft: z.boolean().optional().default(false),
  featured: z.boolean().optional().default(false),
});

export const projectDataSchema = z.object({
  title: z.string().min(1, 'Title is required.'),
  description: z.string().min(1, 'Description is required.'),
  tech: z.array(z.string()).optional().default([]),
  url: safeExternalUrl.optional(),
  repo: safeExternalUrl.optional(),
  featured: z.boolean().optional().default(false),
});

export const bookDataSchema = z.object({
  title: z.string().min(1, 'Title is required.'),
  coverImage: z.string().min(1, 'Cover image is required.'),
  href: optionalExternalUrl,
  order: optionalInteger,
});
