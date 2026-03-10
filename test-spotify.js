import 'dotenv/config';

async function test() {
    const client_id = process.env.SPOTIFY_CLIENT_ID;
    const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
    const refresh_token = process.env.SPOTIFY_REFRESH_TOKEN;

    console.log("Client ID:", client_id ? "Present" : "Missing");
    console.log("Client Secret:", client_secret ? "Present" : "Missing");
    console.log("Refresh Token:", refresh_token ? "Present" : "Missing");

    try {
        const basic = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
        const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                Authorization: `Basic ${basic}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refresh_token,
            }),
        });

        const tokenData = await tokenRes.json();
        console.log("Token response:", tokenData);

        if (tokenData.access_token) {
            const playingRes = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                },
            });
            console.log("Playing status:", playingRes.status);
            if (playingRes.status === 200) {
                console.log("Playing data:", await playingRes.json());
            } else if (playingRes.status === 204) {
                console.log("Nothing is playing (204 No Content)");
            } else {
                console.log("Error from playing:", await playingRes.text());
            }
        }
    } catch (e) {
        console.error(e);
    }
}

test();
