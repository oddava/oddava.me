import { getCollection } from 'astro:content';

export async function getPublishedPosts() {
    const posts = await getCollection('blog');
    return posts
        .filter((post) => !post.data.draft)
        .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
}

type AnimeFavoriteEntry = {
    anime: {
        slug: string;
        title: string;
        title_jp?: string | null;
        rating?: number | string | null;
        cover_image?: string | null;
        cover_image_small?: string | null;
    };
};

const ANISHOWS_API_BASE_URL = (import.meta.env.ANISHOWS_API_BASE_URL ?? 'https://anishows.com/api/v1').replace(/\/$/, '');
const ANISHOWS_USERNAME = import.meta.env.ANISHOWS_USERNAME ?? 'oddava';
const ANISHOWS_FAVORITES_TIMEOUT_MS = 5000;

let cachedAnimeFavorites: AnimeFavoriteEntry[] | null = null;

export async function getAnimeFavorites() {
    if (cachedAnimeFavorites) return cachedAnimeFavorites;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANISHOWS_FAVORITES_TIMEOUT_MS);

    try {
        const favoritesUrl = new URL(`${ANISHOWS_API_BASE_URL}/favorites/`);
        favoritesUrl.searchParams.set('username', ANISHOWS_USERNAME);
        favoritesUrl.searchParams.set('compact', 'true');

        const response = await fetch(favoritesUrl, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`AniShows favorites request failed with ${response.status}.`);
        }

        const payload = (await response.json()) as { results?: unknown };
        if (!Array.isArray(payload.results)) {
            throw new Error('AniShows favorites payload is invalid.');
        }

        cachedAnimeFavorites = payload.results as AnimeFavoriteEntry[];
        return cachedAnimeFavorites;
    } finally {
        clearTimeout(timeout);
    }
}
