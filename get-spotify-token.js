import fetch from 'node-fetch';
import 'dotenv/config';
import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = 'http://127.0.0.1:8888/callback';

if (!clientId || !clientSecret) {
    console.error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env");
    process.exit(1);
}

const scopes = [
    'user-read-currently-playing',
    'user-read-playback-state',
];

const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: scopes.join(' '),
    redirect_uri: redirectUri,
});

const authUrl = `https://accounts.spotify.com/authorize?${authParams.toString()}`;

console.log('1. Go to this URL to authorize the app:');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:8888/callback ...');

const server = http.createServer(async (req, res) => {
    const reqUrl = url.parse(req.url, true);

    if (reqUrl.pathname === '/callback') {
        const code = reqUrl.query.code;

        if (code) {
            console.log('\n2. Received auth code, exchanging for tokens...');

            const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${basicAuth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirectUri,
                }),
            });

            const data = await response.json();

            if (data.refresh_token) {
                console.log('\n✅ SUCCESS! Here is your refresh token:\n');
                console.log('====================================================');
                console.log(data.refresh_token);
                console.log('====================================================\n');
                console.log('Adding this to your .env file...');

                // Auto-add to .env
                const envPath = path.resolve(process.cwd(), '.env');
                let envContent = '';
                if (fs.existsSync(envPath)) {
                    envContent = fs.readFileSync(envPath, 'utf8');
                }

                if (envContent.includes('SPOTIFY_REFRESH_TOKEN=')) {
                    envContent = envContent.replace(/SPOTIFY_REFRESH_TOKEN=.*/, `SPOTIFY_REFRESH_TOKEN=${data.refresh_token}`);
                } else {
                    envContent += `\nSPOTIFY_REFRESH_TOKEN=${data.refresh_token}`;
                }

                fs.writeFileSync(envPath, envContent);
                console.log('Done! You can close this window now.');

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Success!</h1><p>Check your terminal for the refresh token. You can close this window.</p>');

                // Shut down server after a brief delay
                setTimeout(() => {
                    server.close();
                    process.exit(0);
                }, 1000);
            } else {
                console.error('Failed to get refresh token:', data);
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Failed to get refresh token. Check terminal.');
                process.exit(1);
            }
        }
    }
});

server.listen(8888);
