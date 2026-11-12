import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { fetchAdminOverview } from './api';
import { AppsPanel } from './AppsPanel';
import { GuestbookModeration } from './GuestbookModeration';
import { IntegrationsPanel } from './IntegrationsPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { ToastProvider } from './toast';
import type { OverviewResponse } from '../../lib/contracts';
import './AdminPanel.css';

export default function AdminPanel() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}

const SECTION_IDS = ['apps', 'guestbook', 'projects', 'integrations'] as const;
type SectionId = (typeof SECTION_IDS)[number];

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What needs doing, in the site's voice, under the page title. Nothing is
 * said until the numbers are in, so the line never claims "nothing waiting"
 * while it is still loading.
 */
function summaryOf(
  pending: number | undefined,
  attention: boolean,
): string | null {
  if (pending === undefined) return null;
  const inbox =
    pending > 0
      ? `${plural(pending, 'entry', 'entries')} waiting in the guestbook.`
      : 'nothing waiting in the guestbook.';
  return attention ? `${inbox} an integration needs a look.` : inbox;
}

/**
 * The dashboard is laid out like the site's home: the title in a narrow
 * column on the left, which stays put while the work beside it scrolls, and
 * the sections in one column on the right — the apps first, then the
 * guestbook, projects and integrations. The left column also holds
 * the section links, each with what is waiting there. On a phone the two
 * stack, and the links become a row that sticks under the header.
 */
function Dashboard() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [attention, setAttention] = useState(false);
  const [projectCount, setProjectCount] = useState<number>();
  const overviewRequest = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  const active = useActiveSection(SECTION_IDS);
  useStickyOffset(frame);

  /**
   * The counts are garnish on the navigation: a failed load leaves them out
   * rather than raising an error nobody can act on.
   */
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
    // Bumping the id retires an in-flight response after unmount.
    return () => {
      overviewRequest.current += 1;
    };
  }, [refreshOverview]);

  const pending = overview?.metrics.pendingGuestbook;
  const summary = summaryOf(pending, attention);
  const sections: {
    id: SectionId;
    label: string;
    count?: number;
    attention?: boolean;
  }[] = [
    // Rail only: on a phone the apps sit right under the row, and a fourth
    // link would push integrations (and its dot) off the row's end.
    { id: 'apps', label: 'apps' },
    { id: 'guestbook', label: 'guestbook', count: pending || undefined },
    { id: 'projects', label: 'projects', count: projectCount },
    { id: 'integrations', label: 'integrations', attention },
  ];

  return (
    <div className="cab" ref={frame}>
      <aside className="cab-rail">
        <h1 className="pf-title">dashboard</h1>
        <p className="cab-rail__summary">{summary ?? ' '}</p>
        <nav className="cab-sections" aria-label="sections">
          <ul>
            {sections.map((section) => (
              <li
                key={section.id}
                className={
                  section.id === 'apps' ? 'cab-sections__desk' : undefined
                }
              >
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? 'location' : undefined}
                >
                  <span className="cab-sections__label">{section.label}</span>
                  {section.count !== undefined && (
                    <span
                      className={`cab-sections__count ${
                        section.id === 'guestbook' ? 'is-waiting' : ''
                      }`}
                    >
                      {section.count}
                      {section.id === 'guestbook' && (
                        <span className="sr-only"> waiting</span>
                      )}
                    </span>
                  )}
                  {section.attention && (
                    <span
                      className="cab-sections__dot"
                      role="img"
                      aria-label="needs a look"
                    />
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="cab-work">
        <AppsPanel />
        <GuestbookModeration pending={pending} onChanged={refreshOverview} />
        <ProjectsPanel onCount={setProjectCount} />
        {/* Owns its own data: health checks reach upstream APIs and must
            not slow down or fail the rest of the dashboard. */}
        <IntegrationsPanel onAttention={setAttention} />
      </div>
    </div>
  );
}

/**
 * Where the phone's sticky section row sits: right under the site header
 * while that header is stuck, at its real height — it grows when a large
 * text setting wraps its links, which a fixed 56px would slide under. The
 * CSS keeps 56px as the value before this runs.
 */
function useStickyOffset(frame: { current: HTMLDivElement | null }) {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.pf-page > .pf-header');
    const element = frame.current;
    if (!header || !element) return;
    const measure = () => {
      const stuck = getComputedStyle(header).position === 'sticky';
      if (stuck) {
        element.style.setProperty('--cab-sticky', `${header.offsetHeight}px`);
      } else {
        element.style.removeProperty('--cab-sticky');
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [frame]);
}

/**
 * The section whose top has passed the reading line. At the very bottom the
 * last section wins, even when it is too short to reach that line —
 * otherwise it could never be marked. On a phone the line sits under the
 * stuck section row; on a wide screen nothing is stuck above the work, so it
 * is a fixed distance from the top.
 */
function useActiveSection(ids: readonly SectionId[]): SectionId {
  const [active, setActive] = useState<SectionId>(ids[0]);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const row = document.querySelector('.cab-sections');
      const stuck = row !== null && getComputedStyle(row).position === 'sticky';
      const line = (stuck ? row.getBoundingClientRect().bottom : 64) + 32;
      const scrolled = window.scrollY > 0;
      const atBottom =
        scrolled &&
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 2;
      let current = ids[0];
      for (const id of ids) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) current = id;
      }
      setActive(!scrolled ? ids[0] : atBottom ? ids[ids.length - 1] : current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    // Sections grow as their data arrives, which moves the others without a
    // scroll; watching the page's size catches that too.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ids]);

  return active;
}
