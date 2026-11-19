import { constantTimeCompare, sha256Hex } from '../core/crypto';
import { getServerEnv } from '../core/env';
import { json } from '../core/http';
import { firstConfiguredSecret } from '../core/secrets';

/**
 * Who is calling the notes API. Each client has its own bearer secret, so one
 * can be rotated or switched off without touching the other.
 *
 * - `plugin` (`NOTES_API_TOKEN`): the owner's sync clients, such as the
 *   Obsidian plugin. Full access.
 * - `agent` (`NOTES_AGENT_TOKEN`): an AI assistant writing on the owner's
 *   behalf. It may read, create, and update any note, but it may only delete,
 *   rename, or restore notes inside {@link AGENT_NOTES_FOLDER}. See
 *   `notesApiMayRemove`.
 */
export type NotesApiClient = 'plugin' | 'agent';

/** The one folder whose notes the agent token may delete, move, or restore. */
export const AGENT_NOTES_FOLDER = 'megumin';

/**
 * Bearer credentials for the notes sync API.
 *
 * Deliberately not `ADMIN_PANEL_TOKEN`. That secret mints a browser session
 * cookie; these are for clients that cannot hold a cookie (an Obsidian
 * plugin, a bot, a CLI). Sharing one secret would mean a leaked plugin token
 * could also log into Studio. `firstConfiguredSecret` also rejects the
 * `your_*` placeholders in `.env.example`, so copying the example file does
 * not switch the API on.
 */
function notesApiTokens(): Array<{ client: NotesApiClient; token: string }> {
  const tokens: Array<{ client: NotesApiClient; token: string }> = [];
  const plugin = firstConfiguredSecret(getServerEnv('NOTES_API_TOKEN'));
  if (plugin) tokens.push({ client: 'plugin', token: plugin });
  const agent = firstConfiguredSecret(getServerEnv('NOTES_AGENT_TOKEN'));
  // The plugin is listed first, so a value set in both resolves to the
  // plugin: whoever holds it has full access, and the agent scope means
  // nothing. The two secrets must differ (docs/notes-api.md says so).
  if (agent) tokens.push({ client: 'agent', token: agent });
  return tokens;
}

export function isNotesApiEnabled(): boolean {
  return notesApiTokens().length > 0;
}

export function notesApiDisabledResponse(): Response {
  return json(
    {
      error:
        'The notes API is disabled because neither NOTES_API_TOKEN nor NOTES_AGENT_TOKEN is set.',
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
 * The client whose bearer token the request carries, or the response to send
 * when it carries none of them.
 *
 * Both sides are hashed before `constantTimeCompare`. That helper returns
 * immediately when the lengths differ, which would leak a secret's length if
 * the raw strings were compared. SHA-256 digests are a fixed width, so the
 * compare no longer depends on either length. Every configured token is
 * compared, even after a match, so the response time does not say which
 * client a guess was checked against. The same pattern is used for the admin
 * panel token.
 */
export async function authenticateNotesApi(
  request: Request,
): Promise<{ client: NotesApiClient } | Response> {
  const tokens = notesApiTokens();
  if (tokens.length === 0) return notesApiDisabledResponse();

  const presented = presentedToken(request);
  if (!presented) return unauthorized();

  const presentedDigest = await sha256Hex(presented);
  let client: NotesApiClient | null = null;
  for (const candidate of tokens) {
    const matches = constantTimeCompare(
      presentedDigest,
      await sha256Hex(candidate.token),
    );
    if (matches && client === null) client = candidate.client;
  }
  return client ? { client } : unauthorized();
}

/**
 * Whether `client` may delete, rename, or restore the note at `publicPath`
 * (the garden path without `.md`, such as `megumin/hello`).
 *
 * The agent is held to its own folder. A rename counts at both ends: moving
 * one of the owner's notes into the folder and then deleting it would
 * otherwise get around the rule, and moving a note out of the folder takes it
 * out of the place the agent is allowed to clean up.
 */
export function notesApiMayRemove(
  client: NotesApiClient,
  publicPath: string,
): boolean {
  if (client === 'plugin') return true;
  return publicPath.startsWith(`${AGENT_NOTES_FOLDER}/`);
}

export function outsideAgentScopeResponse(): Response {
  return json(
    {
      error: `The agent token may only delete, rename, or restore notes inside ${AGENT_NOTES_FOLDER}/.`,
      code: 'forbidden',
    },
    { status: 403 },
  );
}
