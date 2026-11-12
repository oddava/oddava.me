export type PublicNavigationRoute = {
  href: string;
  isHome: boolean;
  label: string;
};

import { notesIndexUrl } from './notes-url';

// Built on each call: notes links depend on the request's notes base.
function publicNavigationRoutes(): PublicNavigationRoute[] {
  return [
    { href: '/', label: 'oddava', isHome: true },
    { href: '/projects', label: 'projects', isHome: false },
    { href: notesIndexUrl(), label: 'notes', isHome: false },
    { href: '/about', label: 'about', isHome: false },
  ];
}

export function getPublicNavigationRoutes(): PublicNavigationRoute[] {
  return publicNavigationRoutes();
}

export function getStaticSitemapPaths(): string[] {
  return [...publicNavigationRoutes().map((route) => route.href), '/sky'];
}
