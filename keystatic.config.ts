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
                tags: fields.array(fields.text({ label: 'Tag' }), {
                    label: 'Tags',
                    itemLabel: (props) => props.value || 'tag',
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
        projects: collection({
            label: 'Projects',
            slugField: 'title',
            path: 'src/content/projects/*',
            format: { contentField: 'content' },
            schema: {
                title: fields.slug({ name: { label: 'Title' } }),
                description: fields.text({
                    label: 'Description',
                    description: 'A short summary of the project',
                    multiline: true,
                    validation: { isRequired: true },
                }),
                tech: fields.array(fields.text({ label: 'Technology' }), {
                    label: 'Tech Stack',
                    itemLabel: (props) => props.value || 'tech',
                }),
                url: fields.text({
                    label: 'Live URL',
                    description: 'Link to the live project (optional)',
                }),
                repo: fields.text({
                    label: 'Repository URL',
                    description: 'Link to the source code (optional)',
                }),
                featured: fields.checkbox({
                    label: 'Featured',
                    description: 'Show this project on the explore page',
                    defaultValue: false,
                }),
                content: fields.mdx({
                    label: 'Content',
                    description: 'Optional detailed write-up about the project',
                }),
            },
        }),
    },
});

