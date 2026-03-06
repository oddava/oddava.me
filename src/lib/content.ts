import { getCollection } from 'astro:content';

export async function getPublishedPosts() {
    const posts = await getCollection('blog');
    return posts
        .filter((post) => !post.data.draft)
        .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
}
