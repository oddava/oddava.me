import type { APIRoute } from 'astro';
import { connectionsFor } from '../../../../lib/garden/connections';
import { getGardenIndexOrUnavailable } from '../../../../lib/garden';
import {
  adminJson,
  requireSecuredAdminApi,
} from '../../../../lib/server/admin';

// A static sibling of `collections` rather than a `[collection]/…` action: a
// note called "connections" must stay reachable through `[collection]/[id]`.
/**
 * What links to a note, what it links to, and the tags in use — read from the
 * owner's garden index (drafts included), which is already cached per content version. Read-only, so
 * admin auth is the whole contract; there is no mutation to origin-check.
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  const id = url.searchParams.get('id')?.trim();
  if (!id) {
    return adminJson(
      { error: 'Name the note with ?id=.', code: 'invalid_request' },
      { status: 400 },
    );
  }

  // The owner's index: Studio creates every note as a draft, so the public
  // one would show a draft no links, report links to drafts as unwritten
  // notes, and leave draft-only tags out of autocomplete. Safe only because
  // the admin session was proved above.
  const garden = await getGardenIndexOrUnavailable({ includeDrafts: true });
  if (!garden.ok) {
    return adminJson(
      { error: 'Notes are not available yet.', code: 'content_unavailable' },
      {
        status: garden.response.status,
        headers: garden.response.headers,
      },
    );
  }
  return adminJson(connectionsFor(garden.index, id));
};
