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

let cachedAnimeFavorites: any = null;

export async function getAnimeFavorites() {
    if (cachedAnimeFavorites) return cachedAnimeFavorites;
    const apiRes = await fetch('https://anishows.com/api/v1/favorites/?username=oddava&compact=true');
    const apiData = await apiRes.json();
    cachedAnimeFavorites = apiData.results;
    return cachedAnimeFavorites;
}

export async function getAllAnime() {
    const anime = await getCollection('anime');
    return anime.sort((a, b) => getAnimeActivityDate(b) - getAnimeActivityDate(a));
}
