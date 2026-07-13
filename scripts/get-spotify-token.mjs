import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PORT = 8888;
const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}/callback`;
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const AUTHORIZATION_TIMEOUT_MS = 10 * 60 * 1_000;
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

try {
  loadEnvFile();
} catch {
  // Missing credentials are reported below with a more useful message.
}

const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  console.error(
    'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env before running this command.',
  );
  process.exitCode = 1;
} else {
  await authorize(clientId, clientSecret);
}

async function authorize(clientId, clientSecret) {
  const state = randomBytes(32).toString('base64url');
  const authorizationUrl = new URL('https://accounts.spotify.com/authorize');
  authorizationUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: ['user-read-currently-playing', 'user-read-playback-state'].join(
      ' ',
    ),
    redirect_uri: REDIRECT_URI,
    state,
  }).toString();

  let finished = false;
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url === undefined) {
      sendText(response, 404, 'Not found.');
      return;
    }

    const callbackUrl = new URL(request.url, REDIRECT_URI);
    if (callbackUrl.pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    if (callbackUrl.pathname !== '/callback') {
      sendText(response, 404, 'Not found.');
      return;
    }
    if (finished) {
      sendText(
        response,
        409,
        'This authorization request is already complete.',
      );
      return;
    }
    finished = true;

    const returnedState = callbackUrl.searchParams.get('state');
    if (!matchesState(returnedState, state)) {
      finish(
        server,
        response,
        400,
        'Spotify returned an invalid OAuth state. Start the command again.',
        1,
      );
      return;
    }

    const authorizationError = callbackUrl.searchParams.get('error');
    if (authorizationError) {
      finish(
        server,
        response,
        400,
        `Spotify authorization failed: ${authorizationError}`,
        1,
      );
      return;
    }

    const code = callbackUrl.searchParams.get('code');
    if (!code) {
      finish(
        server,
        response,
        400,
        'Spotify did not return an authorization code.',
        1,
      );
      return;
    }

    try {
      const refreshToken = await exchangeCode(clientId, clientSecret, code);
      await updateEnvFile(refreshToken);
      console.info(
        'Spotify authorization succeeded. SPOTIFY_REFRESH_TOKEN was updated in .env.',
      );
      console.info(
        'A token saved in Admin → Integrations overrides this environment fallback.',
      );
      finish(
        server,
        response,
        200,
        'Authorization succeeded. You may close this tab.',
        0,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Spotify authorization failed.';
      console.error(message);
      finish(server, response, 502, message, 1);
    }
  });

  server.requestTimeout = TOKEN_REQUEST_TIMEOUT_MS;
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${CALLBACK_PORT} is already in use. Stop that process and retry.`
        : `Spotify callback server failed: ${error.message}`,
    );
    process.exitCode = 1;
  });

  server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
    console.info('Open this URL to authorize Spotify:');
    console.info(authorizationUrl.href);
    console.info(`Waiting for the callback at ${REDIRECT_URI} …`);
  });

  const timeout = setTimeout(() => {
    if (finished) return;
    finished = true;
    console.error('Spotify authorization timed out. Run the command again.');
    process.exitCode = 1;
    server.close();
  }, AUTHORIZATION_TIMEOUT_MS);
  timeout.unref();
  server.once('close', () => clearTimeout(timeout));
}

function matchesState(actual, expected) {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

async function exchangeCode(clientId, clientSecret, code) {
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64',
  );
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  const refreshToken = payload?.refresh_token;
  if (!response.ok || typeof refreshToken !== 'string' || !refreshToken) {
    const detail =
      typeof payload?.error_description === 'string'
        ? payload.error_description
        : `Spotify token exchange failed (${response.status}).`;
    throw new Error(detail);
  }
  return refreshToken;
}

async function updateEnvFile(refreshToken) {
  const envPath = path.resolve('.env');
  const current = await readFile(envPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const setting = `SPOTIFY_REFRESH_TOKEN=${refreshToken}`;
  const next = /^SPOTIFY_REFRESH_TOKEN=.*$/m.test(current)
    ? current.replace(/^SPOTIFY_REFRESH_TOKEN=.*$/m, setting)
    : `${current.trimEnd()}${current.trim() ? '\n' : ''}${setting}\n`;
  await writeFile(envPath, next, { encoding: 'utf8', mode: 0o600 });
}

function sendText(response, status, message) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(message);
}

function finish(server, response, status, message, exitCode) {
  sendText(response, status, message);
  process.exitCode = exitCode;
  server.close();
}
