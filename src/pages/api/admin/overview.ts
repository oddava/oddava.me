import type { APIRoute } from 'astro';
import type { OverviewResponse } from '../../../lib/contracts';
import { getGardenIndexOrUnavailable } from '../../../lib/garden';
import { adminJson, requireSecuredAdminApi } from '../../../lib/server/admin';
import { isStorageUnavailableError } from '../../../lib/server/core';
import { readGuestbookEntries } from '../../../lib/server/guestbook';

async function readAdminGuestbookEntries() {
  try {
    // The storage adapter owns its network deadline. Racing it with another
    // timer would return while request-bound Redis I/O was still in flight.
    return await readGuestbookEntries();
  } catch (error) {
    if (!isStorageUnavailableError(error)) {
      console.error('[admin-overview] Guestbook metrics failed.', error);
    }
    return [];
  }
}

async function loadNoteCount(): Promise<number> {
  try {
    // Through the same guard the public routes use, so an empty or
    // mid-mutation store reads as "no count yet" rather than as a failure
    // worth logging. A counter on a dashboard is not worth failing the
    // dashboard for, so a real error still degrades to zero — but it is the
    // only thing that reaches the log line.
    const garden = await getGardenIndexOrUnavailable();
    return garden.ok ? garden.index.documents.length : 0;
  } catch (error) {
    console.error('[admin-overview] Note metrics failed.', error);
    return 0;
  }
}

/**
 * Dashboard counters only. Integration health lives behind
 * `/api/admin/integrations`, which is what probes upstream APIs — keeping it
 * out of here means loading the dashboard no longer costs a live token refresh
 * against every provider.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  const [noteCount, guestbookEntries] = await Promise.all([
    loadNoteCount(),
    readAdminGuestbookEntries(),
  ]);

  const pending = guestbookEntries.filter(
    (entry) => entry.status === 'pending',
  ).length;
  const approved = guestbookEntries.filter(
    (entry) => entry.status === 'approved',
  ).length;

  return adminJson({
    metrics: {
      notes: noteCount,
      pendingGuestbook: pending,
      approvedGuestbook: approved,
    },
  } satisfies OverviewResponse);
};
