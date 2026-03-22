import type { APIRoute } from 'astro';
import { requireAdminApi, getAdminIntegrationStatuses } from '../../../lib/server/admin';
import { json } from '../../../lib/server/community';
import { getCollection } from 'astro:content';
import { getClickerCount } from '../../../lib/server/clicker';
import { DIFFICULTIES, readLeaderboard } from '../../../lib/server/minesweeper';
import { readGuestbookEntries } from '../../../lib/server/guestbook';

export const GET: APIRoute = async ({ cookies }) => {
  const authError = await requireAdminApi(cookies);
  if (authError) return authError;

  const [posts, projects, guestbookEntries, clickCount, leaderboardGroups, integrations] = await Promise.all([
    getCollection('blog'),
    getCollection('projects'),
    readGuestbookEntries(),
    getClickerCount(),
    Promise.all(DIFFICULTIES.map(async (difficulty) => [difficulty, await readLeaderboard(difficulty)] as const)),
    getAdminIntegrationStatuses(),
  ]);

  const pending = guestbookEntries.filter((entry) => entry.status === 'pending').length;
  const approved = guestbookEntries.filter((entry) => entry.status === 'approved').length;
  const drafts = posts.filter((post) => post.data.draft).length;
  const featuredProjects = projects.filter((project) => project.data.featured).length;

  const leaderboardSummary = Object.fromEntries(
    leaderboardGroups.map(([difficulty, entries]) => [difficulty, entries.length]),
  );

  return json({
    metrics: {
      posts: posts.length,
      drafts,
      projects: projects.length,
      featuredProjects,
      pendingGuestbook: pending,
      approvedGuestbook: approved,
      clickCount,
      leaderboardSummary,
    },
    integrations,
  });
};
