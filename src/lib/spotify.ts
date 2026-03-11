let cachedAccessToken: string | null = null;
let tokenExpirationTime: number = 0;

export const getAccessToken = async () => {
    if (cachedAccessToken && Date.now() < tokenExpirationTime) {
        return { access_token: cachedAccessToken };
    }

    const client_id = import.meta.env.SPOTIFY_CLIENT_ID;
    const client_secret = import.meta.env.SPOTIFY_CLIENT_SECRET;
    const refresh_token = import.meta.env.SPOTIFY_REFRESH_TOKEN;

    if (!client_id || !client_secret || !refresh_token) {
        throw new Error('Spotify credentials are missing.');
    }

    const basic = btoa(`${client_id}:${client_secret}`);
    const TOKEN_ENDPOINT = `https://accounts.spotify.com/api/token`;

    const response = await fetch(TOKEN_ENDPOINT, {
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

    const data = await response.json();

    if (data.access_token) {
        cachedAccessToken = data.access_token;
        // data.expires_in is usually 3600. We subtract 300 (5 minutes) for safety.
        tokenExpirationTime = Date.now() + (data.expires_in - 300) * 1000;
    }

    return data;
};

export const getNowPlaying = async () => {
    const { access_token } = await getAccessToken();
    const NOW_PLAYING_ENDPOINT = `https://api.spotify.com/v1/me/player/currently-playing`;

    return fetch(NOW_PLAYING_ENDPOINT, {
        headers: {
            Authorization: `Bearer ${access_token}`,
        },
    });
};
