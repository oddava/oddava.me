import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
    schema: z.object({
        title: z.string(),
        date: z.coerce.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional().default([]),
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

const projects = defineCollection({
    loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
    schema: z.object({
        title: z.string(),
        description: z.string(),
        tech: z.array(z.string()).optional().default([]),
        url: z.string().optional(),
        repo: z.string().optional(),
        featured: z.boolean().optional().default(false),
    }),
});

export const collections = { blog, anime, projects };
