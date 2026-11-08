import type { Page } from '@playwright/test';

/** A screenshot-shaped stand-in: a gradient card with a few UI-ish bars. */
function cover(from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><rect x="80" y="90" width="640" height="420" rx="18" fill="#000" opacity=".55"/><rect x="120" y="140" width="260" height="22" rx="6" fill="#fff" opacity=".8"/><rect x="120" y="186" width="420" height="12" rx="6" fill="#fff" opacity=".35"/><rect x="120" y="212" width="360" height="12" rx="6" fill="#fff" opacity=".35"/><rect x="120" y="270" width="560" height="190" rx="12" fill="#fff" opacity=".12"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const HOUR = 3_600_000;

export interface AdminMockState {
  guestbook: {
    id: string;
    name: string;
    message: string;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
    ipFingerprint?: string;
    userAgent?: string;
  }[];
  projects: Record<string, unknown>[];
  revision: number;
  integrations: Record<string, unknown>[];
  saves: unknown[];
  conflicts: number;
}

export async function mockAdmin(page: Page): Promise<AdminMockState> {
  const now = Date.now();
  const state: AdminMockState = {
    guestbook: [
      {
        id: 'g1',
        name: 'mira',
        message:
          'found this through the minesweeper link — the no-guessing rule is such a good idea. bookmarked the notes too.',
        status: 'pending',
        createdAt: new Date(now - 2 * HOUR).toISOString(),
        ipFingerprint: '9f3ac1e07b6d42a8',
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      },
      {
        id: 'g2',
        name: 'tomasz',
        message: 'hello from kraków 👋 love the cat.',
        status: 'pending',
        createdAt: new Date(now - 26 * HOUR).toISOString(),
        ipFingerprint: 'c0de44aa91b2ff10',
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      },
      {
        id: 'g3',
        name: 'cheap-seo-links',
        message: 'best backlinks cheap!!! visit now',
        status: 'pending',
        createdAt: new Date(now - 4 * 24 * HOUR).toISOString(),
        ipFingerprint: '0000aa11bb22cc33',
        userAgent: 'python-requests/2.31',
      },
      {
        id: 'g4',
        name: 'jun',
        message: 'the notes graph is beautiful.',
        status: 'approved',
        createdAt: new Date(now - 30 * 24 * HOUR).toISOString(),
      },
    ],
    projects: [
      {
        id: 'p1',
        name: "Oddava's minesweeper",
        description: 'a daily minesweeper game with no 50/50',
        year: 2026,
        stack: ['preact', 'workers'],
        site: 'https://mines.oddava.me',
        image: { src: cover('#1b3a7a', '#7aa7ff'), alt: 'the game board' },
        featured: true,
        hidden: false,
      },
      {
        id: 'p2',
        name: 'Ishbay',
        description:
          'payroll management specifically for sock manufacturing businesses',
        year: 'now',
        stack: ['django', 'postgres'],
        image: { src: cover('#2b2b2b', '#6b6b6b'), alt: 'the payroll table' },
        hidden: false,
      },
      {
        id: 'p3',
        name: 'oddava.me',
        description: 'this site',
        year: 2026,
        stack: ['astro', 'redis'],
        hidden: false,
      },
      {
        id: 'p4',
        name: 'AniShows',
        description: 'an anime tracker with reviews, forums, and a catalog',
        year: 2025,
        stack: ['next', 'prisma'],
        image: { src: cover('#3a1b4a', '#adcaff'), alt: 'the catalog' },
        hidden: true,
      },
    ],
    revision: 7,
    integrations: [
      {
        id: 'spotify',
        name: 'Spotify',
        description: '',
        state: 'ok',
        detail: 'connected. nothing is playing right now.',
        manageable: true,
        enabled: true,
        configured: true,
        fields: [],
        credentials: [],
        checkedAt: new Date(now - 20_000).toISOString(),
      },
      {
        id: 'lanyard',
        name: 'Lanyard',
        description: '',
        state: 'unconfigured',
        detail:
          'not configured. set DISCORD_USER_ID in the deployment environment.',
        manageable: true,
        enabled: true,
        configured: false,
        fields: [],
        credentials: [],
      },
    ],
    saves: [],
    conflicts: 0,
  };

  const counts = () => ({
    metrics: {
      notes: 15,
      pendingGuestbook: state.guestbook.filter((e) => e.status === 'pending')
        .length,
      approvedGuestbook: state.guestbook.filter((e) => e.status === 'approved')
        .length,
    },
  });

  // Only the app's endpoints: the fixture's own modules live under
  // `/src/components/admin/api/` and must load untouched.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();

      if (path === '/api/admin/overview')
        return route.fulfill({ json: counts() });

      if (path === '/api/guestbook/admin') {
        if (method === 'GET') {
          const status = url.searchParams.get('status');
          return route.fulfill({
            json: {
              entries: state.guestbook.filter((e) => e.status === status),
            },
          });
        }
        const body = request.postDataJSON();
        if (method === 'PATCH') {
          const entry = state.guestbook.find((e) => e.id === body.id);
          if (entry) entry.status = body.status;
        } else {
          state.guestbook = state.guestbook.filter(
            (e) => e.status === 'approved',
          );
        }
        return route.fulfill({ json: { entries: state.guestbook } });
      }

      if (path === '/api/admin/projects') {
        if (method === 'PUT') {
          const body = request.postDataJSON();
          // Compare-and-set, as the real endpoint does.
          if (body.revision !== state.revision) {
            state.conflicts += 1;
            return route.fulfill({
              status: 409,
              json: { error: 'Projects changed elsewhere.', code: 'conflict' },
            });
          }
          state.saves.push(body);
          state.projects = body.projects;
          state.revision += 1;
        }
        return route.fulfill({
          json: { projects: state.projects, revision: state.revision },
        });
      }

      if (path === '/api/admin/integrations')
        return route.fulfill({ json: { integrations: state.integrations } });

      const integration = path.match(/^\/api\/admin\/integrations\/([^/]+)/);
      if (integration) {
        const item = state.integrations.find((i) => i.id === integration[1])!;
        if (method === 'PATCH') {
          item.enabled = request.postDataJSON().enabled;
          item.state = item.enabled
            ? item.configured
              ? 'ok'
              : 'unconfigured'
            : 'disabled';
        }
        item.checkedAt = new Date().toISOString();
        return route.fulfill({ json: { integration: item } });
      }

      return route.fulfill({ status: 404, json: { error: 'not mocked' } });
    },
  );

  return state;
}
