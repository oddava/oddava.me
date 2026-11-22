import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { fetchAdminOverview } from './api';
import { AppsPanel } from './AppsPanel';
import { GuestbookModeration } from './GuestbookModeration';
import { IntegrationsPanel } from './IntegrationsPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { SkyModeration } from './SkyModeration';
import { ToastProvider } from './toast';
import type { OverviewResponse } from '../../lib/contracts';
import './AdminPanel.css';

interface AdminPanelProps {
  children?: ComponentChildren;
}

export default function AdminPanel({ children }: AdminPanelProps) {
  return (
    <ToastProvider>
      <Dashboard appearance={children} />
    </ToastProvider>
  );
}

const VIEWS = [
  'overview',
  'guestbook',
  'sky',
  'projects',
  'integrations',
] as const;
type ViewId = (typeof VIEWS)[number];

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function readHashView(): ViewId {
  if (typeof window === 'undefined') return 'overview';
  const raw = window.location.hash.replace(/^#/, '');
  return (VIEWS as readonly string[]).includes(raw)
    ? (raw as ViewId)
    : 'overview';
}

function summaryOf(
  pending: number | undefined,
  pendingStars: number | undefined,
  attention: boolean,
): string | null {
  if (pending === undefined) return null;
  const parts: string[] = [];
  if (pending > 0)
    parts.push(`${plural(pending, 'entry', 'entries')} in guestbook`);
  if (pendingStars && pendingStars > 0) {
    parts.push(`${plural(pendingStars, 'word', 'words')} in sky`);
  }
  if (attention) parts.push('an integration needs a look');
  return parts.length > 0 ? `${parts.join(' · ')}.` : 'all quiet.';
}

/**
 * Unified 3-column admin workspace modeled after the notes shell:
 * sticky left navigation rail (back to site, appearance, focused views,
 * studio link, sign out), centered 44rem active workspace, and a balancing
 * right gutter on wide screens so the canvas stays centered.
 * On narrow screens, a slim top bar opens the rail as a slide-over drawer.
 */
function Dashboard({ appearance }: { appearance?: ComponentChildren }) {
  const [view, setView] = useState<ViewId>(readHashView);
  const [navOpen, setNavOpen] = useState(false);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [attention, setAttention] = useState(false);
  const [projectCount, setProjectCount] = useState<number>();
  const overviewRequest = useRef(0);
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const selectView = useCallback((next: ViewId) => {
    setView(next);
    setNavOpen(false);
    if (typeof window !== 'undefined') {
      const targetHash = next === 'overview' ? '' : `#${next}`;
      if (window.location.hash !== targetHash) {
        window.history.replaceState(
          null,
          '',
          targetHash || `${window.location.pathname}${window.location.search}`,
        );
      }
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, []);

  useEffect(() => {
    const onHash = () => setView(readHashView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('cab-nav-open', navOpen);
    if (navOpen) {
      closeBtnRef.current?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && navOpen) {
        setNavOpen(false);
        openBtnRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('cab-nav-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  const refreshOverview = useCallback(() => {
    const requestId = ++overviewRequest.current;
    fetchAdminOverview()
      .then((data) => {
        if (requestId === overviewRequest.current) setOverview(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshOverview();
    return () => {
      overviewRequest.current += 1;
    };
  }, [refreshOverview]);

  const pending = overview?.metrics.pendingGuestbook;
  const pendingStars = overview?.metrics.pendingStars;
  const summary = summaryOf(pending, pendingStars, attention);
  const totalWaiting = (pending ?? 0) + (pendingStars ?? 0);

  const navItems: {
    id: ViewId;
    label: string;
    count?: number;
    waiting?: boolean;
    attention?: boolean;
  }[] = [
    { id: 'overview', label: 'overview' },
    {
      id: 'guestbook',
      label: 'guestbook',
      count: pending || undefined,
      waiting: true,
    },
    {
      id: 'sky',
      label: 'sky',
      count: pendingStars || undefined,
      waiting: true,
    },
    { id: 'projects', label: 'projects', count: projectCount },
    { id: 'integrations', label: 'integrations', attention },
  ];

  const closeDrawer = () => {
    setNavOpen(false);
    openBtnRef.current?.focus();
  };

  return (
    <div className="cab-shell">
      <div className="cab-nav-scrim" hidden={!navOpen} onClick={closeDrawer} />

      <aside
        className="cab-nav"
        data-open={navOpen ? '' : undefined}
        aria-label="Admin navigation"
      >
        <div className="cab-nav__top">
          <div className="cab-nav__bar">
            <a className="cab-nav__home" href="/">
              ← oddava
            </a>
            <div className="cab-nav__actions">
              {appearance}
              <button
                ref={closeBtnRef}
                className="cab-nav__close"
                type="button"
                aria-label="Close admin menu"
                onClick={closeDrawer}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <nav className="cab-sections" aria-label="sections">
          <p className="cab-nav__label">admin</p>
          <ul role="list">
            {navItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="cab-nav__item"
                  aria-current={view === item.id ? 'page' : undefined}
                  onClick={() => selectView(item.id)}
                >
                  <span className="cab-sections__label">{item.label}</span>
                  {item.count !== undefined && (
                    <span
                      className={`cab-sections__count ${
                        item.waiting ? 'is-waiting' : ''
                      }`}
                    >
                      {item.count}
                      {item.waiting && (
                        <span className="sr-only"> waiting</span>
                      )}
                    </span>
                  )}
                  {item.attention && (
                    <span
                      className="cab-sections__dot"
                      role="img"
                      aria-label="needs a look"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="cab-nav__foot">
          <a className="cab-nav__link" href="/admin/files">
            <span>notes studio</span>
            <span className="cab-nav__arrow" aria-hidden="true">
              →
            </span>
          </a>
          <form
            className="cab-signout"
            method="post"
            action="/api/admin/logout"
          >
            <button className="cab-nav__signout" type="submit">
              sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="cab-center">
        <header className="cab-mobile-bar">
          <button
            ref={openBtnRef}
            className="cab-menu-btn"
            type="button"
            aria-expanded={navOpen}
            aria-label="Open admin menu"
            onClick={() => setNavOpen(true)}
          >
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="M3 5h12M3 9h12M3 13h12" />
            </svg>
          </button>
          <span className="cab-mobile-bar__title">{view}</span>
          {(totalWaiting > 0 || attention) && view !== 'overview' && (
            <button
              type="button"
              className="cab-mobile-bar__pill"
              onClick={() => selectView('overview')}
            >
              overview
            </button>
          )}
        </header>

        <div className="cab-work">
          <div className="cab-view" hidden={view !== 'overview'}>
            <header className="cab-overview-head">
              <h1 className="pf-title">admin</h1>
              <p className="cab-overview-head__lede">{summary ?? ' '}</p>
            </header>

            <section className="cab-overview-group" aria-label="Status">
              <h2 className="cab-label">workspace</h2>
              <div className="cab-overview-rows">
                <button
                  type="button"
                  className="cab-entry"
                  onClick={() => selectView('guestbook')}
                >
                  <span className="cab-entry__name">guestbook</span>
                  <span className="cab-entry__meta">
                    {pending === undefined ? (
                      '—'
                    ) : pending > 0 ? (
                      <span className="cab-entry__accent">
                        {pending} waiting
                      </span>
                    ) : (
                      'all clear'
                    )}
                    <span className="cab-entry__arrow" aria-hidden="true">
                      →
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className="cab-entry"
                  onClick={() => selectView('sky')}
                >
                  <span className="cab-entry__name">sky</span>
                  <span className="cab-entry__meta">
                    {pendingStars === undefined ? (
                      '—'
                    ) : pendingStars > 0 ? (
                      <span className="cab-entry__accent">
                        {pendingStars} waiting
                      </span>
                    ) : (
                      'all clear'
                    )}
                    <span className="cab-entry__arrow" aria-hidden="true">
                      →
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className="cab-entry"
                  onClick={() => selectView('projects')}
                >
                  <span className="cab-entry__name">projects</span>
                  <span className="cab-entry__meta">
                    {projectCount !== undefined
                      ? plural(projectCount, 'project', 'projects')
                      : '—'}
                    <span className="cab-entry__arrow" aria-hidden="true">
                      →
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className="cab-entry"
                  onClick={() => selectView('integrations')}
                >
                  <span className="cab-entry__name">integrations</span>
                  <span className="cab-entry__meta">
                    {attention ? (
                      <span className="cab-entry__warn">needs a look</span>
                    ) : (
                      'healthy'
                    )}
                    <span className="cab-entry__arrow" aria-hidden="true">
                      →
                    </span>
                  </span>
                </button>
              </div>
            </section>

            <AppsPanel />
          </div>

          <div className="cab-view" hidden={view !== 'guestbook'}>
            <GuestbookModeration
              pending={pending}
              onChanged={refreshOverview}
            />
          </div>

          <div className="cab-view" hidden={view !== 'sky'}>
            <SkyModeration pending={pendingStars} onChanged={refreshOverview} />
          </div>

          <div className="cab-view" hidden={view !== 'projects'}>
            <ProjectsPanel onCount={setProjectCount} />
          </div>

          <div className="cab-view" hidden={view !== 'integrations'}>
            <IntegrationsPanel onAttention={setAttention} />
          </div>
        </div>
      </div>
    </div>
  );
}
