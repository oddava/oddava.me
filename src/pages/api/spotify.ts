import type { APIRoute } from 'astro';
import { getNowPlaying } from '../../lib/spotify';
import { getServerEnv } from '../../lib/server/env';
import { fetchWithTimeout } from '../../lib/server/community';
import type { SpotifyNowPlaying } from '../../lib/contracts';

interface SpotifyApiPayload {
    is_playing?: boolean;
    progress_ms?: number | null;
    item?: {
        name?: string;
        duration_ms?: number;
        artists?: Array<{ name?: string }>;
        album?: { images?: Array<{ url?: string }> };
        external_urls?: { spotify?: string };
    } | null;
}

interface LanyardPayload {
    success?: boolean;
    data?: {
        spotify?: {
            song?: string;
            artist?: string;
            album_art_url?: string;
            track_id?: string;
            timestamps?: {
                start?: number;
                end?: number;
            };
        };
    };
}

let cachedData: SpotifyNowPlaying | null = null;
let cacheExpiration: number = 0;

export const GET: APIRoute = async () => {
    if (cachedData && Date.now() < cacheExpiration) {
        // Adjust the progressMs locally before serving the cached response
        // so the progress bar doesn't jump backwards if the cache is a few seconds old.
        const ageMs = Date.now() - (cacheExpiration - 5000);
        const adjustedData = { ...cachedData };
        if (adjustedData.progressMs && adjustedData.isPlaying) {
            adjustedData.progressMs += ageMs;
        }

        return new Response(JSON.stringify(adjustedData), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=5',
            },
        });
    }

    try {
        const response = await getNowPlaying();

        if (response.status === 204 || !response.ok) {
            console.log("Spotify status: ", response.status);
            // Fallback to Lanyard if Spotify fails (e.g. 403 Forbidden due to no Premium)
            return await fetchLanyardFallback();
        }

        const songText = await response.text();
        const song = songText ? (JSON.parse(songText) as SpotifyApiPayload) : null;

        if (!song?.item?.name || !song.item.duration_ms) {
            return await fetchLanyardFallback();
        }

        const isPlaying = Boolean(song.is_playing);
        const title = song.item.name;
        const artist = song.item.artists?.map((item) => item.name).filter(Boolean).join(', ') ?? '';
        const albumImageUrl = song.item.album?.images?.[0]?.url;
        const songUrl = song.item.external_urls?.spotify;
        const durationMs = song.item.duration_ms;
        const progressMs = song.progress_ms ?? 0;

        const responseData: SpotifyNowPlaying = {
            albumImageUrl,
            artist,
            isPlaying,
            songUrl,
            title,
            durationMs,
            progressMs
        };

        cachedData = responseData;
        cacheExpiration = Date.now() + 5000;

        return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=5',
            },
        });
    } catch (error: unknown) {
        console.error("Spotify API error", error);
        return await fetchLanyardFallback();
    }
};

async function fetchLanyardFallback() {
    console.log("Falling back to Lanyard...");
    const discordId = getServerEnv('DISCORD_USER_ID')?.trim();

    if (!discordId) {
        return createErrorResponse("No Discord ID configured for fallback");
    }

    try {
        const res = await fetchWithTimeout(`https://api.lanyard.rest/v1/users/${discordId}`);
        if (!res.ok) {
            throw new Error(`Lanyard returned ${res.status}.`);
        }
        const data = (await res.json()) as LanyardPayload;

        if (data.success && data.data?.spotify?.song) {
            const spotify = data.data.spotify;
            const responseData: SpotifyNowPlaying = {
                isPlaying: true,
                title: spotify.song,
                artist: spotify.artist ?? '',
                albumImageUrl: spotify.album_art_url,
                songUrl: spotify.track_id ? `https://open.spotify.com/track/${spotify.track_id}` : undefined,
                durationMs: spotify.timestamps?.end && spotify.timestamps.start
                    ? spotify.timestamps.end - spotify.timestamps.start
                    : 0,
                progressMs: spotify.timestamps?.start ? Date.now() - spotify.timestamps.start : 0,
            };

            cachedData = responseData;
            cacheExpiration = Date.now() + 5000;

            return new Response(JSON.stringify(responseData), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=5',
                },
            });
        }

        const fallbackData: SpotifyNowPlaying = { isPlaying: false, fromFallback: true };
        cachedData = fallbackData;
        cacheExpiration = Date.now() + 5000;

        return new Response(JSON.stringify(fallbackData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error("Lanyard API error", error);
        return createErrorResponse("Lanyard API error");
    }
}

function createErrorResponse(errorMsg: string) {
    const errorData: SpotifyNowPlaying = { isPlaying: false, error: errorMsg };
    cachedData = errorData;
    cacheExpiration = Date.now() + 5000;
    
    return new Response(JSON.stringify(errorData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
