import { getServerEnv } from './server/env';
import { fetchWithTimeout } from './server/community';

let cachedAccessToken: string | null = null;
let tokenExpirationTime: number = 0;

interface SpotifyTokenResponse {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

export const getAccessToken = async (): Promise<{ access_token: string }> => {
    if (cachedAccessToken && Date.now() < tokenExpirationTime) {
        return { access_token: cachedAccessToken };
    }

    const client_id = getServerEnv('SPOTIFY_CLIENT_ID');
    const client_secret = getServerEnv('SPOTIFY_CLIENT_SECRET');
    const refresh_token = getServerEnv('SPOTIFY_REFRESH_TOKEN');

    if (!client_id || !client_secret || !refresh_token) {
        throw new Error('Spotify credentials are missing.');
    }

    const basic = btoa(`${client_id}:${client_secret}`);
    const TOKEN_ENDPOINT = `https://accounts.spotify.com/api/token`;

    const response = await fetchWithTimeout(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token,
        }),
    });

    const data = (await response.json()) as SpotifyTokenResponse;

    if (!response.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || 'Could not refresh Spotify access token.');
    }

    cachedAccessToken = data.access_token;
    // data.expires_in is usually 3600. We subtract 300 (5 minutes) for safety.
    tokenExpirationTime = Date.now() + Math.max(60, (data.expires_in ?? 3600) - 300) * 1000;

    return { access_token: data.access_token };
};

export const getNowPlaying = async () => {
    const { access_token } = await getAccessToken();
    const NOW_PLAYING_ENDPOINT = `https://api.spotify.com/v1/me/player/currently-playing`;

    return fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
        headers: {
            Authorization: `Bearer ${access_token}`,
        },
    });
};
