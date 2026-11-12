import type { ComponentChildren } from 'preact';

interface App {
  name: string;
  /** What it is for, in a few words. */
  what: string;
  href: string;
  glyph: ComponentChildren;
}

/**
 * The tools the site runs besides this dashboard. Notes is this site's own
 * editor (same tab); the rest are self-hosted apps on their own subdomains,
 * each behind its own sign-in, so they open in a new tab.
 */
const APPS: App[] = [
  {
    name: 'notes',
    what: 'write and edit the notes',
    href: '/admin/files',
    glyph: (
      <>
        <path d="M4 16.2 4.8 13 13 4.8a1.6 1.6 0 0 1 2.2 0 1.6 1.6 0 0 1 0 2.2L7 15.2Z" />
        <path d="m11.8 6 2.2 2.2" />
      </>
    ),
  },
  {
    name: 'zipline',
    what: 'file and screenshot uploads',
    href: 'https://i.oddava.me',
    glyph: (
      <>
        <path d="M10 12.5V4M6.6 7.4 10 4l3.4 3.4" />
        <path d="M4 12.5v2A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-2" />
      </>
    ),
  },
  {
    name: 'beszel',
    what: 'server stats',
    href: 'https://stats.oddava.me',
    glyph: <path d="M2.5 10.5h3l2-5 4 9 2-4h4" />,
  },
  {
    name: 'dozzle',
    what: 'container logs',
    href: 'https://logs.oddava.me',
    glyph: (
      <>
        <rect x="2.75" y="4" width="14.5" height="12" rx="2" />
        <path d="m6.25 8.25 2.25 2-2.25 2M10.5 12.5H14" />
      </>
    ),
  },
];

const hostOf = (href: string) =>
  href.startsWith('/') ? 'this site' : new URL(href).host;

/**
 * A launcher at the top of the dashboard: one small card per app, read like
 * the site's own rows — a tint under the pointer and the arrow sliding in.
 */
export function AppsPanel() {
  return (
    <section id="apps" className="adm-section" aria-labelledby="apps-title">
      <header className="adm-head">
        <h2 id="apps-title" className="adm-head__title">
          apps
        </h2>
      </header>
      <ul className="adm-apps">
        {APPS.map((app) => {
          const external = !app.href.startsWith('/');
          return (
            <li key={app.name}>
              <a
                className="adm-app press"
                href={app.href}
                {...(external ? { target: '_blank', rel: 'noopener' } : {})}
              >
                <span className="adm-app__glyph" aria-hidden="true">
                  <svg
                    viewBox="0 0 20 20"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    {app.glyph}
                  </svg>
                </span>
                <span className="adm-app__text">
                  <span className="adm-app__name">
                    {app.name}
                    <span className="pf-arrow" aria-hidden="true">
                      {external ? '↗' : '→'}
                    </span>
                  </span>
                  <span className="adm-app__what">{app.what}</span>
                  <span className="adm-app__host">{hostOf(app.href)}</span>
                </span>
                {external && (
                  <span className="sr-only"> (opens in new tab)</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
