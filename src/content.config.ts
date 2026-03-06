import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
    schema: z.object({
        title: z.string(),
        date: z.coerce.string(),
        description: z.string().optional(),
        draft: z.boolean().optional().default(false),
    }),
});

const anime = defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/anime' }),
    schema: z.object({
        title: z.string(),
        year: z.coerce.number().optional(),
        rating: z.coerce.number().optional(),
        updatedAt: z.coerce.string().optional(),
        status: z.enum(['watching', 'completed', 'dropped', 'plan-to-watch']),
    }),
});

export const collections = { blog, anime };
