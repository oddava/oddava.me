import type { APIRoute } from 'astro';
import {
  getAdminIntegrationStatuses,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../../../lib/server/admin';
import { json } from '../../../lib/server/community';
import { getCollection } from 'astro:content';
import { readGuestbookEntries } from '../../../lib/server/guestbook';

export const GET: APIRoute = async ({ cookies }) => {
  const authError = await requireSecuredAdminApi(cookies);
  if (authError) return authError;

  const [posts, projects, guestbookEntries, integrations] = await Promise.all([
    getCollection('blog'),
    getCollection('projects'),
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

  return withAdminSecurityHeaders(
    json({
      metrics: {
        posts: posts.length,
        drafts,
        projects: projects.length,
        featuredProjects,
        pendingGuestbook: pending,
        approvedGuestbook: approved,
      },
      integrations,
    }),
  );
};
