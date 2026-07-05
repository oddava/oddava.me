export type PublicNavigationRoute = {
  href: string;
  isHome: boolean;
  label: string;
};

const PUBLIC_NAVIGATION_ROUTES = [
  { href: '/', label: 'oddava', isHome: true },
  { href: '/blog', label: 'writing', isHome: false },
  { href: '/projects', label: 'projects', isHome: false },
  { href: '/about', label: 'about', isHome: false },
] as const satisfies readonly PublicNavigationRoute[];

const EXTRA_STATIC_SITEMAP_PATHS = ['/links'] as const;

export function getPublicNavigationRoutes(): PublicNavigationRoute[] {
  return PUBLIC_NAVIGATION_ROUTES.map((route) => ({ ...route }));
}

export function getStaticSitemapPaths(): string[] {
  return [
    ...PUBLIC_NAVIGATION_ROUTES.map((route) => route.href),
    ...EXTRA_STATIC_SITEMAP_PATHS,
  ];
}
