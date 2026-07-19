export type PublicNavigationRoute = {
  href: string;
  isHome: boolean;
  label: string;
};

export const NOTES_GRAPH_PATH = '/notes/graph';

const PUBLIC_NAVIGATION_ROUTES = [
  { href: '/', label: 'oddava', isHome: true },
  { href: '/notes', label: 'notes', isHome: false },
  { href: '/about', label: 'about', isHome: false },
] as const satisfies readonly PublicNavigationRoute[];

const EXTRA_STATIC_SITEMAP_PATHS = ['/links', NOTES_GRAPH_PATH] as const;

export function getPublicNavigationRoutes(): PublicNavigationRoute[] {
  return PUBLIC_NAVIGATION_ROUTES.map((route) => ({ ...route }));
}

export function getStaticSitemapPaths(): string[] {
  return [
    ...PUBLIC_NAVIGATION_ROUTES.map((route) => route.href),
    ...EXTRA_STATIC_SITEMAP_PATHS,
  ];
}
