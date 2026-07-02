import type { APIRoute } from 'astro';
import {
  adminJson,
  getAdminIntegrationStatuses,
  requireSecuredAdminApi,
} from '../../../lib/server/admin';
import { getCollection } from 'astro:content';
import { readGuestbookEntries } from '../../../lib/server/guestbook';

export const GET: APIRoute = async ({ cookies }) => {
  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  const [posts, projects, books, guestbookEntries, integrations] =
    await Promise.all([
      getCollection('blog'),
      getCollection('projects'),
      getCollection('books'),
      readGuestbookEntries(),
      getAdminIntegrationStatuses(),
    ]);

  const pending = guestbookEntries.filter(
    (entry) => entry.status === 'pending',
  ).length;
  const approved = guestbookEntries.filter(
    (entry) => entry.status === 'approved',
  ).length;
  const drafts = posts.filter((post) => post.data.draft).length;
  const featuredProjects = projects.filter(
    (project) => project.data.featured,
  ).length;

  return adminJson({
    metrics: {
      posts: posts.length,
      drafts,
      projects: projects.length,
      featuredProjects,
      books: books.length,
      pendingGuestbook: pending,
      approvedGuestbook: approved,
    },
    integrations,
  });
};
