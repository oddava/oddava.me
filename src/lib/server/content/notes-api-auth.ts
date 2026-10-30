import { constantTimeCompare, sha256Hex } from '../core/crypto';
import { getServerEnv } from '../core/env';
import { json } from '../core/http';
import { firstConfiguredSecret } from '../core/secrets';

/**
 * Bearer credential for the notes sync API.
 *
 * Deliberately not `ADMIN_PANEL_TOKEN`. That secret mints a browser session
 * cookie; this one is for clients that cannot hold a cookie (an Obsidian
 * plugin, a bot, a CLI). Sharing one secret would mean a leaked plugin token
 * could also log into Studio. `firstConfiguredSecret` also rejects the
 * `your_*` placeholders in `.env.example`, so copying the example file does
 * not switch the API on.
 */
function notesApiToken(): string | undefined {
  return firstConfiguredSecret(getServerEnv('NOTES_API_TOKEN'));
}

export function isNotesApiEnabled(): boolean {
  return notesApiToken() !== undefined;
}

export function notesApiDisabledResponse(): Response {
  return json(
    {
      error: 'The notes API is disabled because NOTES_API_TOKEN is not set.',
      code: 'notes_api_disabled',
    },
    { status: 503 },
  );
}

function unauthorized(): Response {
  return json(
    { error: 'Unauthorized.', code: 'unauthorized' },
    {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    },
  );
}

// A sync token is a short random string (`openssl rand -hex 32` is 64
// characters). Capping the header before hashing keeps a multi-megabyte
// Authorization value from turning the compare into a CPU sink. The cap is
// far above any token this API will issue.
const MAX_PRESENTED_TOKEN_LENGTH = 512;

function presentedToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const token = match?.[1];
  if (!token || token.length > MAX_PRESENTED_TOKEN_LENGTH) return null;
  return token;
}

/**
 * Null when the bearer token matches `NOTES_API_TOKEN`.
 *
 * Both sides are hashed before `constantTimeCompare`. That helper returns
 * immediately when the lengths differ, which would leak the secret's length
 * if the raw strings were compared. SHA-256 digests are a fixed width, so
 * the compare no longer depends on either length. The same pattern is used
 * for the admin panel token.
 */
export async function notesApiUnauthorized(
  request: Request,
): Promise<Response | null> {
  const configured = notesApiToken();
  if (!configured) return notesApiDisabledResponse();

  const presented = presentedToken(request);
  if (!presented) return unauthorized();

  const matches = constantTimeCompare(
    await sha256Hex(presented),
    await sha256Hex(configured),
  );
  return matches ? null : unauthorized();
}
