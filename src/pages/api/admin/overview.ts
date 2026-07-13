import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import type { OverviewResponse } from '../../../lib/contracts';
import { adminJson, requireSecuredAdminApi } from '../../../lib/server/admin';
import { isStorageUnavailableError } from '../../../lib/server/community';
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
    return (await getCollection('notes')).length;
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
