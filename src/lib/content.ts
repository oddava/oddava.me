import { getCollection } from 'astro:content';

function getAnimeActivityDate(entry: { data: { updatedAt?: string; year?: number } }): number {
    if (entry.data.updatedAt) {
        return new Date(entry.data.updatedAt).getTime();
    }
    if (entry.data.year) {
        return new Date(`${entry.data.year}-01-01`).getTime();
    }
    return 0;
}

export async function getPublishedPosts() {
    const posts = await getCollection('blog');
    return posts
        .filter((post) => !post.data.draft)
        .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
}

export async function getAllAnime() {
    const anime = await getCollection('anime');
    return anime.sort((a, b) => getAnimeActivityDate(b) - getAnimeActivityDate(a));
}
