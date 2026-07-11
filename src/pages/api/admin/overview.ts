import type { APIRoute } from 'astro';
import type { CollectionEntry } from 'astro:content';
import {
  adminJson,
  getAdminIntegrationStatuses,
  requireSecuredAdminApi,
} from '../../../lib/server/admin';
import { getCollection } from 'astro:content';
import { isStorageUnavailableError } from '../../../lib/server/community';
import { readGuestbookEntries } from '../../../lib/server/guestbook';

const STORAGE_READ_TIMEOUT_MS = 4_000;

async function withStorageTimeout<T>(
  promise: Promise<T>,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), STORAGE_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readAdminGuestbookEntries() {
  try {
    return await withStorageTimeout(readGuestbookEntries(), []);
  } catch (error) {
    if (isStorageUnavailableError(error)) return [];
    return [];
  }
}

async function loadCollection(): Promise<CollectionEntry<'notes'>[]> {
  try {
    return await getCollection('notes');
  } catch {
    return [];
  }
}

async function loadIntegrations() {
  try {
    return await getAdminIntegrationStatuses();
  } catch (error) {
    return [
      {
        name: 'Integrations',
        healthy: false,
        detail:
          error instanceof Error
            ? error.message
            : 'Could not load integration statuses.',
        manageable: false,
      },
    ];
  }
}

export const GET: APIRoute = async ({ cookies }) => {
  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  const [notes, guestbookEntries, integrations] = await Promise.all([
    loadCollection(),
    readAdminGuestbookEntries(),
    loadIntegrations(),
  ]);

  const pending = guestbookEntries.filter(
    (entry) => entry.status === 'pending',
  ).length;
  const approved = guestbookEntries.filter(
    (entry) => entry.status === 'approved',
  ).length;
  const drafts = notes.filter((note) => note.data.draft).length;

  return adminJson({
    metrics: {
      notes: notes.length,
      drafts,
      pendingGuestbook: pending,
      approvedGuestbook: approved,
    },
    integrations,
  });
};
