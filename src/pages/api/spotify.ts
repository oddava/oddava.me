import type { APIRoute } from 'astro';
import { getNowPlaying } from '../../lib/spotify';

export const GET: APIRoute = async () => {
    try {
        const response = await getNowPlaying();

        if (response.status === 204 || response.status > 400) {
            console.log("Spotify status: ", response.status);
            // Fallback to Lanyard if Spotify fails (e.g. 403 Forbidden due to no Premium)
            return await fetchLanyardFallback();
        }

        const songText = await response.text();
        const song = songText ? JSON.parse(songText) : null;

        if (!song || song.item === null) {
            return await fetchLanyardFallback();
        }

        const isPlaying = song.is_playing;
        const title = song.item.name;
        const artist = song.item.artists.map((_artist: any) => _artist.name).join(', ');
        const albumImageUrl = song.item.album.images[0].url;
        const songUrl = song.item.external_urls.spotify;
        const durationMs = song.item.duration_ms;
        const progressMs = song.progress_ms;

        return new Response(JSON.stringify({
            albumImageUrl,
            artist,
            isPlaying,
            songUrl,
            title,
            durationMs,
            progressMs
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=5',
            },
        });
    } catch (error: any) {
        console.error("Spotify API error", error);
        return await fetchLanyardFallback();
    }
};

async function fetchLanyardFallback() {
    console.log("Falling back to Lanyard...");
    const discordId = import.meta.env.DISCORD_USER_ID;

    if (!discordId) {
        return createErrorResponse("No Discord ID configured for fallback");
    }

    try {
        const res = await fetch(`https://api.lanyard.rest/v1/users/${discordId}`);
        const data = await res.json();

        if (data.success && data.data.spotify) {
            const spotify = data.data.spotify;
            return new Response(JSON.stringify({
                isPlaying: true,
                title: spotify.song,
                artist: spotify.artist,
                albumImageUrl: spotify.album_art_url,
                songUrl: `https://open.spotify.com/track/${spotify.track_id}`,
                durationMs: spotify.timestamps?.end ? spotify.timestamps.end - spotify.timestamps.start : 0,
                progressMs: spotify.timestamps?.start ? Date.now() - spotify.timestamps.start : 0,
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=5',
                },
            });
        }

        return new Response(JSON.stringify({ isPlaying: false, fromFallback: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error("Lanyard API error", error);
        return createErrorResponse("Lanyard API error");
    }
}

function createErrorResponse(errorMsg: string) {
    return new Response(JSON.stringify({ isPlaying: false, error: errorMsg }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
