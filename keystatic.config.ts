import { config, fields, collection } from '@keystatic/core';

const isProd = import.meta.env.PROD;

export default config({
    storage: isProd
        ? {
            kind: 'github',
            repo: 'oddava/oddava.me',
        }
        : {
            kind: 'local',
        },
    ui: {
        brand: { name: 'Oddava' },
    },
    collections: {
        posts: collection({
            label: 'Blog Posts',
            slugField: 'title',
            path: 'src/content/blog/*',
            format: { contentField: 'content' },
            schema: {
                title: fields.slug({ name: { label: 'Title' } }),
                date: fields.date({
                    label: 'Date',
                    description: 'The date of the post (e.g., 2026-03-01)',
                    validation: { isRequired: true },
                }),
                description: fields.text({
                    label: 'Description',
                    description: 'A short summary for the index page',
                    multiline: true,
                }),
                draft: fields.checkbox({
                    label: 'Draft',
                    description: 'Hide this post from the public site',
                    defaultValue: false,
                }),
                content: fields.mdx({
                    label: 'Content',
                    options: {
                        image: {
                            directory: 'public/images/blog',
                            publicPath: '/images/blog/',
                        },
                    },
                }),
            },
        }),
        anime: collection({
            label: 'Anime',
            slugField: 'title',
            path: 'src/content/anime/*',
            format: { contentField: 'review' },
            schema: {
                title: fields.slug({ name: { label: 'Title' } }),
                year: fields.integer({ label: 'Year' }),
                rating: fields.integer({ label: 'Rating (1-10)' }),
                updatedAt: fields.date({
                    label: 'Updated At',
                    description: 'Used for chronological ordering in the Explore activity feed.',
                }),
                status: fields.select({
                    label: 'Status',
                    options: [
                        { label: 'Watching', value: 'watching' },
                        { label: 'Completed', value: 'completed' },
                        { label: 'Dropped', value: 'dropped' },
                        { label: 'Plan to Watch', value: 'plan-to-watch' },
                    ],
                    defaultValue: 'completed',
                }),
                review: fields.mdx({
                    label: 'Review',
                    options: {
                        image: {
                            directory: 'public/images/anime',
                            publicPath: '/images/anime/',
                        },
                    },
                }),
            },
        }),
    },
});
