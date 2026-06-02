import { getCollection } from 'astro:content';

const WORDS_PER_MINUTE = 225;

export type PostStats = {
    wordCount: number;
    readingTimeMinutes: number;
};

export function getPostStats(body = ''): PostStats {
    const text = body
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[{}#[\]>*_~|:-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const wordCount = text ? text.split(' ').length : 0;

    return {
        wordCount,
        readingTimeMinutes: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
    };
}

export function formatPostStats(stats: PostStats): string {
    const wordLabel = stats.wordCount === 1 ? 'word' : 'words';
    const minuteLabel = stats.readingTimeMinutes === 1 ? 'min' : 'mins';

    return `${stats.readingTimeMinutes} ${minuteLabel} read · ${stats.wordCount} ${wordLabel}`;
}

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
        url?: string | null;
    };
};

type AniListFavoriteNode = {
    id: number;
    siteUrl?: string | null;
    title?: {
        romaji?: string | null;
        english?: string | null;
        native?: string | null;
    } | null;
    coverImage?: {
        large?: string | null;
        medium?: string | null;
    } | null;
    averageScore?: number | null;
};

type AniListFavoritesResponse = {
    data?: {
        User?: {
            favourites?: {
                anime?: {
                    pageInfo?: {
                        hasNextPage?: boolean | null;
                    } | null;
                    nodes?: AniListFavoriteNode[] | null;
                } | null;
            } | null;
        } | null;
    };
    errors?: unknown;
};

const ANILIST_API_URL = 'https://graphql.anilist.co';
const ANILIST_USERNAME = import.meta.env.ANILIST_USERNAME ?? 'codeJ';
const ANILIST_FAVORITES_TIMEOUT_MS = 5000;
const ANILIST_FAVORITES_PER_PAGE = 50;
const ANILIST_FAVORITES_QUERY = `
query FavoriteAnime($name: String!, $page: Int!, $perPage: Int!) {
  User(name: $name) {
    favourites {
      anime(page: $page, perPage: $perPage) {
        pageInfo {
          hasNextPage
        }
        nodes {
          id
          siteUrl
          title {
            romaji
            english
            native
          }
          coverImage {
            large
            medium
          }
          averageScore
        }
      }
    }
  }
}
`;

let cachedAnimeFavorites: AnimeFavoriteEntry[] | null = null;

function mapAniListFavorite(node: AniListFavoriteNode): AnimeFavoriteEntry {
    const title = node.title?.english ?? node.title?.romaji ?? node.title?.native ?? `AniList #${node.id}`;
    const rating = typeof node.averageScore === 'number' ? (node.averageScore / 10).toFixed(1) : null;

    return {
        anime: {
            slug: String(node.id),
            title,
            title_jp: node.title?.native ?? null,
            rating,
            cover_image: node.coverImage?.large ?? null,
            cover_image_small: node.coverImage?.medium ?? node.coverImage?.large ?? null,
            url: node.siteUrl ?? `https://anilist.co/anime/${node.id}`,
        },
    };
}

async function fetchAniListFavoritesPage(page: number, signal: AbortSignal): Promise<AniListFavoriteNode[]> {
    const response = await fetch(ANILIST_API_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: ANILIST_FAVORITES_QUERY,
            variables: {
                name: ANILIST_USERNAME,
                page,
                perPage: ANILIST_FAVORITES_PER_PAGE,
            },
        }),
        signal,
    });

    if (!response.ok) {
        throw new Error(`AniList favorites request failed with ${response.status}.`);
    }

    const payload = (await response.json()) as AniListFavoritesResponse;
    if (payload.errors) {
        throw new Error('AniList favorites request returned errors.');
    }

    const anime = payload.data?.User?.favourites?.anime;
    if (!anime || !Array.isArray(anime.nodes)) {
        throw new Error('AniList favorites payload is invalid.');
    }

    const nodes = [...anime.nodes];
    if (anime.pageInfo?.hasNextPage) {
        nodes.push(...(await fetchAniListFavoritesPage(page + 1, signal)));
    }

    return nodes;
}

export async function getAnimeFavorites() {
    if (cachedAnimeFavorites) return cachedAnimeFavorites;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANILIST_FAVORITES_TIMEOUT_MS);

    try {
        const favorites = await fetchAniListFavoritesPage(1, controller.signal);
        cachedAnimeFavorites = favorites.map(mapAniListFavorite);
        return cachedAnimeFavorites;
    } finally {
        clearTimeout(timeout);
    }
}
