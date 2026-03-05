import { config, fields, collection } from '@keystatic/core';

export default config({
    storage: {
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
    },
});
