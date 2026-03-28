import { config, fields, collection } from '@keystatic/core';
import { block } from '@keystatic/core/content-components';

const isProd = import.meta.env.PROD;

function uniqueImageFilename(originalFilename: string): string {
    const sanitized = originalFilename
        .trim()
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        ?.toLowerCase() ?? 'image';

    const extensionMatch = sanitized.match(/(\.[a-z0-9]+)$/);
    const extension = extensionMatch?.[1] ?? '';
    const basename = (extension ? sanitized.slice(0, -extension.length) : sanitized)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'image';

    const uniqueSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return `${basename}-${uniqueSuffix}${extension}`;
}

const mdxComponents = {
    CardComparison: block({
        label: 'Card Comparison',
        description: 'Side-by-side before/after image comparison block.',
        schema: {
            beforeSrc: fields.text({
                label: 'Before Image Source',
                validation: { isRequired: true },
            }),
            beforeAlt: fields.text({
                label: 'Before Image Alt Text',
                validation: { isRequired: true },
            }),
            afterSrc: fields.text({
                label: 'After Image Source',
                validation: { isRequired: true },
            }),
            afterAlt: fields.text({
                label: 'After Image Alt Text',
                validation: { isRequired: true },
            }),
            beforeCaption: fields.text({ label: 'Before Caption' }),
            afterCaption: fields.text({ label: 'After Caption' }),
            fit: fields.text({ label: 'Fit Mode (cover/contain/fill/none/scale-down)' }),
            allowUpscale: fields.checkbox({
                label: 'Allow Upscale',
                defaultValue: false,
            }),
            align: fields.text({ label: 'Alignment (top/center/bottom)' }),
            height: fields.text({ label: 'Height (CSS value)' }),
            aspect: fields.text({ label: 'Aspect Ratio (CSS value)' }),
            gap: fields.text({ label: 'Gap (CSS value)' }),
            beforeHeight: fields.text({ label: 'Before Height (CSS value)' }),
            afterHeight: fields.text({ label: 'After Height (CSS value)' }),
            beforeAspect: fields.text({ label: 'Before Aspect Ratio (CSS value)' }),
            afterAspect: fields.text({ label: 'After Aspect Ratio (CSS value)' }),
            beforeFit: fields.text({ label: 'Before Fit Mode' }),
            afterFit: fields.text({ label: 'After Fit Mode' }),
            beforeAllowUpscale: fields.checkbox({
                label: 'Before Allow Upscale',
                defaultValue: false,
            }),
            afterAllowUpscale: fields.checkbox({
                label: 'After Allow Upscale',
                defaultValue: false,
            }),
            beforeAlign: fields.text({ label: 'Before Alignment (top/center/bottom)' }),
            afterAlign: fields.text({ label: 'After Alignment (top/center/bottom)' }),
            beforePosition: fields.text({ label: 'Before Object Position (CSS value)' }),
            afterPosition: fields.text({ label: 'After Object Position (CSS value)' }),
            class: fields.text({ label: 'Custom Class Name' }),
        },
        ContentView: () => null,
    }),
};

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
                            transformFilename: uniqueImageFilename,
                        },
                    },
                    components: mdxComponents,
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
                    components: mdxComponents,
                }),
            },
        }),
    },
});
